import { unzipSync, strFromU8 } from 'fflate'
import type { Cylinder, DivePlan, GasPhase } from '../types'
import { uid } from './storage'

export interface SubsurfaceImportResult {
  dives: DivePlan[]
  suggestedCylinders: Cylinder[]  // gases in the plan not matched to day's cylinders
  warnings: string[]
}

// ─── Unit parsers ───────────────────────────────────────────────────────────

function parseDepthM(s: string): number {
  return parseFloat(s.replace(/\s*m$/i, '').trim()) || 0
}

// "62:17 min" → 62 + 17/60 minutes
function parseTimeMin(s: string): number {
  const clean = s.replace(/\s*min$/i, '').trim()
  const [minStr, secStr] = clean.split(':')
  return (parseInt(minStr) || 0) + (parseInt(secStr) || 0) / 60
}

function parsePct(s: string): number {
  return parseFloat(s.replace(/%$/, '').trim()) || 0
}

function parseBar(s: string): number {
  return parseFloat(s.replace(/\s*bar$/i, '').trim()) || 0
}

function parseLiters(s: string): number {
  return parseFloat(s.replace(/\s*l$/i, '').trim()) || 0
}

// ─── Mix naming ─────────────────────────────────────────────────────────────

function formatMix(o2Pct: number, hePct: number): string {
  if (Math.abs(o2Pct - 21) < 1.5 && hePct < 1) return 'Air'
  if (Math.abs(o2Pct - 100) < 1 && hePct < 1) return 'O2'
  if (hePct < 1) return `EAN${Math.round(o2Pct)}`
  return `TMX${Math.round(o2Pct)}/${Math.round(hePct)}`
}

function matchCylinder(cylinders: Cylinder[], o2Pct: number, hePct: number): Cylinder | undefined {
  const target = formatMix(o2Pct, hePct).toLowerCase()
  return cylinders.find(c => c.mix.toLowerCase() === target)
}

// ─── File extraction ─────────────────────────────────────────────────────────

// .ssrm is a ZIP archive; .xml is plain text
export async function extractXml(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer())
  if (file.name.toLowerCase().endsWith('.ssrm')) {
    const entries = unzipSync(data)
    const xmlEntry = Object.entries(entries).find(([name]) => name.toLowerCase().endsWith('.xml'))
    if (!xmlEntry) throw new Error('No XML file found inside .ssrm archive')
    return strFromU8(xmlEntry[1])
  }
  return new TextDecoder().decode(data)
}

// ─── Main parser ─────────────────────────────────────────────────────────────

export function parseSubsurfaceXml(xml: string, existingCylinders: Cylinder[]): SubsurfaceImportResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Could not parse XML file')

  // Only planned dives have a <diveplanner> child; logged dives do not
  const plannedDiveEls = Array.from(doc.querySelectorAll('dive')).filter(el =>
    el.querySelector('diveplanner')
  )
  if (plannedDiveEls.length === 0) {
    throw new Error(
      'No planned dives found. Export a dive plan from Subsurface: File → Export → Subsurface XML.'
    )
  }

  const warnings: string[] = []
  const suggestedCylinders: Cylinder[] = []
  const seenMixes = new Set<string>()
  const dives: DivePlan[] = []

  for (const el of plannedDiveEls) {
    const dive = parseDiveEl(el, existingCylinders, suggestedCylinders, seenMixes, warnings)
    if (dive) dives.push(dive)
  }

  return { dives, suggestedCylinders, warnings }
}

// ─── Per-dive parsing ────────────────────────────────────────────────────────

interface SubCyl {
  idx: number
  o2Pct: number
  hePct: number
  mix: string
  ratedVolumeFt3: number
  ratedPressurePsi: number
  endPressurePsi: number
  description: string
  use: string
}

function parseDiveEl(
  el: Element,
  existingCylinders: Cylinder[],
  suggestedCylinders: Cylinder[],
  seenMixes: Set<string>,
  warnings: string[],
): DivePlan | null {
  const planner = el.querySelector('diveplanner')!

  // SAC rates stored as mL/min; convert to L/min for calculation
  const bottomSacRaw = parseFloat(planner.getAttribute('bottomsac') ?? '20000')
  const decoSacRaw = parseFloat(planner.getAttribute('decosac') ?? '17000')
  const bottomLpm = bottomSacRaw > 1000 ? bottomSacRaw / 1000 : bottomSacRaw
  const decoLpm = decoSacRaw > 1000 ? decoSacRaw / 1000 : decoSacRaw

  // Cylinder elements are direct children of <dive>, not nested under divecomputer
  const subCyls: SubCyl[] = Array.from(el.children)
    .filter(c => c.tagName === 'cylinder')
    .map((c, idx) => {
      const o2Pct = parsePct(c.getAttribute('o2') ?? '21%')
      const hePct = parsePct(c.getAttribute('he') ?? '0%')
      const sizeL = parseLiters(c.getAttribute('size') ?? '11.1 l')
      const wpBar = parseBar(c.getAttribute('workpressure') ?? '207 bar')
      const endBar = parseBar(c.getAttribute('end') ?? '0 bar')
      return {
        idx,
        o2Pct,
        hePct,
        mix: formatMix(o2Pct, hePct),
        // Rated ft³ = water_vol_L × (workpressure_bar / 1 atm) × 0.035316 ft³/L
        ratedVolumeFt3: Math.round(sizeL * (wpBar / 1.01325) * 0.035316),
        ratedPressurePsi: Math.round(wpBar * 14.5038),
        endPressurePsi: Math.round(endBar * 14.5038),
        description: c.getAttribute('description') ?? '',
        use: c.getAttribute('use') ?? (idx === 0 ? 'OC-primary' : 'deco'),
      }
    })

  // Map each gasmix index to a TecPlan cylinder ID
  const allAvailable = [...existingCylinders, ...suggestedCylinders]
  const cylIdMap = new Map<number, string>()

  for (const sc of subCyls) {
    const matched = matchCylinder(allAvailable, sc.o2Pct, sc.hePct)
    if (matched) {
      cylIdMap.set(sc.idx, matched.id)
    } else {
      // Reuse a previously suggested cylinder for this mix, or create a new one
      const alreadySuggested = suggestedCylinders.find(c => c.mix === sc.mix)
      if (alreadySuggested) {
        cylIdMap.set(sc.idx, alreadySuggested.id)
      } else if (!seenMixes.has(sc.mix)) {
        const isPrimary = sc.use === 'OC-primary'
        const newCyl: Cylinder = {
          id: uid(),
          label: sc.description || sc.mix,
          type: isPrimary ? 'back_gas' : 'stage',
          mix: sc.mix,
          ratedVolume: sc.ratedVolumeFt3 || 80,
          ratedPressure: sc.ratedPressurePsi || 3000,
          count: 1,
          refillBetweenDives: isPrimary,
        }
        suggestedCylinders.push(newCyl)
        seenMixes.add(sc.mix)
        cylIdMap.set(sc.idx, newCyl.id)
        warnings.push(`No matching cylinder for ${sc.mix} — will add "${newCyl.label}" to Equipment`)
      }
    }
  }

  // Parse plan waypoints
  const points = Array.from(planner.querySelectorAll('point')).map(p => ({
    depthM: parseDepthM(p.getAttribute('depth') ?? '0 m'),
    timMin: parseTimeMin(p.getAttribute('time') ?? '0:00 min'),
    gasmix: parseInt(p.getAttribute('gasmix') ?? '0'),
  }))

  if (points.length < 2) {
    warnings.push('Skipping dive — too few plan points')
    return null
  }

  const maxDepthM = Math.max(...points.map(p => p.depthM))
  const maxDepthFt = Math.round(maxDepthM * 3.28084)
  const totalRuntime = points[points.length - 1].timMin

  // Bottom time = last time the diver is at ≥85% of max depth
  const atBottom = points.filter(p => p.depthM >= maxDepthM * 0.85)
  const bottomTimeMin = atBottom.length ? Math.max(...atBottom.map(p => p.timMin)) : 0

  // Turn pressure from the planned end PSI of the primary cylinder
  const primarySc = subCyls.find(c => c.use === 'OC-primary') ?? subCyls[0]
  const turnPressure = primarySc?.endPressurePsi > 0 ? primarySc.endPressurePsi : 2000

  // Accumulate gas consumption per gasmix across all segments
  // Volume (ft³) = SAC (L/min) × duration (min) × avg_abs_pressure (bar) × 0.035316 (ft³/L)
  const phaseMap = new Map<number, {
    volFt3: number
    durationMin: number
    firstDepthFt: number
    firstTimMin: number
  }>()

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    const avgDepthM = (from.depthM + to.depthM) / 2
    const absBar = avgDepthM / 10 + 1
    const durMin = to.timMin - from.timMin
    // Primary gas uses bottomSac; deco gases use decoSac
    const sacLpm = from.gasmix === 0 ? bottomLpm : decoLpm
    const volFt3 = sacLpm * durMin * absBar * 0.035316

    const ex = phaseMap.get(from.gasmix)
    if (ex) {
      ex.volFt3 += volFt3
      ex.durationMin += durMin
    } else {
      phaseMap.set(from.gasmix, {
        volFt3,
        durationMin: durMin,
        firstDepthFt: Math.round(from.depthM * 3.28084),
        firstTimMin: from.timMin,
      })
    }
  }

  const gasPhases: GasPhase[] = [...phaseMap.entries()]
    .sort((a, b) => a[1].firstTimMin - b[1].firstTimMin)
    .flatMap(([gasmix, phase]) => {
      const cylId = cylIdMap.get(gasmix)
      if (!cylId) return []
      const isPrimary = gasmix === 0
      return [{
        id: uid(),
        cylinderId: cylId,
        displayDepth: isPrimary ? `${maxDepthFt} ft bottom` : `${phase.firstDepthFt} ft deco`,
        duration: Math.round(phase.durationMin),
        requiredVolume: Math.round(phase.volFt3 * 10) / 10,
      }]
    })

  if (gasPhases.length === 0) {
    warnings.push('No gas phases could be computed — check that cylinders are defined')
    return null
  }

  const diveDate = el.getAttribute('date') ?? ''
  const diveNum = el.getAttribute('number') ?? ''
  const label = diveDate
    ? `${diveDate} — ${maxDepthFt} ft plan`
    : diveNum
      ? `Subsurface dive #${diveNum}`
      : 'Subsurface import'

  return {
    id: uid(),
    label,
    bottomDepth: maxDepthFt,
    bottomTime: Math.round(bottomTimeMin),
    totalRuntime: Math.round(totalRuntime),
    turnPressure,
    gasPhases,
  }
}
