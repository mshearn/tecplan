import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Cylinder, DivePlan } from '../types'
import { uid } from './storage'
import { computePhasesFromProfile } from './profile'
import type { ProfileRow } from './profile'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Dm5PdfParseResult {
  plans: Dm5PdfPlan[]
  warnings: string[]
}

export interface Dm5PdfPlan {
  name: string          // "Main plan" | "Backup plan"
  rows: Dm5PdfRow[]
  gases: string[]       // unique normalized mix strings in order of first use
}

interface Dm5PdfRow {
  depth: number
  arriveMin: number
  stopMin: number
  mix: string           // normalized, e.g. "TMX21/25", "EAN50", "O2"
}

export interface Dm5ImportResult {
  dives: DivePlan[]
  suggestedCylinders: Cylinder[]
  warnings: string[]
}

// ─── Gas normalization ───────────────────────────────────────────────────────

function formatMix(o2Pct: number, hePct: number): string {
  if (Math.abs(o2Pct - 21) < 1.5 && hePct < 1) return 'Air'
  if (Math.abs(o2Pct - 100) < 1.5 && hePct < 1) return 'O2'
  if (hePct < 1) return `EAN${Math.round(o2Pct)}`
  return `TMX${Math.round(o2Pct)}/${Math.round(hePct)}`
}

// Parse DM5 mix string ("TX 21/25", "Nx 50", "Nx 99") to normalized form
function normalizeDm5Mix(type: string, val: string): string | null {
  const t = type.toUpperCase()
  if (t === 'TX') {
    const parts = val.split('/')
    if (parts.length !== 2) return null
    const o2 = parseInt(parts[0])
    const he = parseInt(parts[1])
    if (isNaN(o2) || isNaN(he)) return null
    return formatMix(o2, he)
  }
  if (t === 'NX' || t === 'EAN' || t === 'O2') {
    const o2 = t === 'O2' ? 100 : parseInt(val)
    if (isNaN(o2)) return null
    return formatMix(o2, 0)
  }
  if (t === 'AIR') return 'Air'
  return null
}

// ─── PDF text extraction ─────────────────────────────────────────────────────

async function extractLines(file: File): Promise<string[]> {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjsLib.getDocument({ data }).promise

  const allLines: string[] = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()

    type RowItem = { x: number; text: string }
    const rowMap = new Map<number, RowItem[]>()

    for (const rawItem of content.items) {
      // TextItem has str; TextMarkedContent does not
      if (!('str' in rawItem)) continue
      const item = rawItem as { str: string; transform: number[] }
      const text = item.str.trim()
      if (!text) continue

      const y = item.transform[5]
      const x = item.transform[4]

      // Find an existing row within 3px tolerance
      let rowY: number | undefined
      let bestDist = Infinity
      for (const existY of rowMap.keys()) {
        const dist = Math.abs(existY - y)
        if (dist <= 3 && dist < bestDist) {
          rowY = existY
          bestDist = dist
        }
      }

      if (rowY === undefined) {
        rowMap.set(y, [{ x, text }])
      } else {
        rowMap.get(rowY)!.push({ x, text })
      }
    }

    // Sort rows top-to-bottom (PDF Y increases upward, so descending Y = top-to-bottom)
    const lines = [...rowMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) =>
        items
          .sort((a, b) => a.x - b.x)
          .map(i => i.text)
          .join(' ')
          .trim()
      )
      .filter(l => l.length > 0)

    allLines.push(...lines)
  }

  return allLines
}

// ─── Row parsing ─────────────────────────────────────────────────────────────

// Parse one DM5 table row: "{depth} ft {diveTime} {stopTime} {mixType} {mixVal} {end} ft {pO2} {info...}"
function parseDm5Row(line: string): (Dm5PdfRow & { info: string }) | null {
  const tokens = line.trim().split(/\s+/)
  if (tokens.length < 9) return null

  let i = 0

  const depth = parseInt(tokens[i++])
  if (isNaN(depth) || tokens[i++] !== 'ft') return null

  const arriveMin = parseInt(tokens[i++])
  if (isNaN(arriveMin)) return null

  const stopMin = parseInt(tokens[i++])
  if (isNaN(stopMin)) return null

  const mixType = tokens[i++]
  const mixVal = tokens[i++]

  const mix = normalizeDm5Mix(mixType, mixVal)
  if (!mix) return null

  // END value and "ft" — value can be negative
  i++ // skip end number
  if (tokens[i++] !== 'ft') return null

  const pO2 = parseFloat(tokens[i++])
  if (isNaN(pO2)) return null

  const info = tokens.slice(i).join(' ')

  return { depth, arriveMin, stopMin, mix, info }
}

// ─── Main parse function ──────────────────────────────────────────────────────

export async function parseDm5Pdf(file: File): Promise<Dm5PdfParseResult> {
  const warnings: string[] = []
  const lines = await extractLines(file)

  const plans: Dm5PdfPlan[] = []
  let planName = 'Main plan'
  let planRows: Dm5PdfRow[] = []
  let planGases: string[] = []
  let inTable = false

  function flushPlan() {
    if (planRows.length > 0) {
      plans.push({ name: planName, rows: planRows, gases: planGases })
    }
    planRows = []
    planGases = []
    inTable = false
  }

  for (const line of lines) {
    const upper = line.toUpperCase()

    // Section header
    if (upper.includes('BACKUP') && upper.includes('PLAN')) {
      flushPlan()
      planName = 'Backup plan'
      continue
    }

    // Table header row — "Depth Dive time Stop time Mix END pO2 Info"
    if (upper.startsWith('DEPTH') && upper.includes('DIVE TIME')) {
      inTable = true
      continue
    }

    if (!inTable) continue

    const parsed = parseDm5Row(line)
    if (!parsed) continue

    const { info, ...row } = parsed
    planRows.push(row)

    // Track unique gases in order of first appearance
    if (!planGases.includes(row.mix)) {
      planGases.push(row.mix)
    }

    if (info.toLowerCase().includes('total dive time')) {
      flushPlan()
      planName = 'Backup plan'  // anything after first total is backup
    }
  }

  flushPlan()

  if (plans.length === 0) {
    warnings.push('No DM5 plan table found in PDF. Make sure this is a Suunto DM5 export.')
  }

  return { plans, warnings }
}

// ─── Build importable result ──────────────────────────────────────────────────

export function buildDm5ImportResult(
  parsed: Dm5PdfParseResult,
  existingCylinders: Cylinder[],
  sacCfm: number,
  transitRateFtMin = 60,
): Dm5ImportResult {
  const warnings = [...parsed.warnings]
  const suggestedCylinders: Cylinder[] = []
  const seenMixes = new Set<string>()

  // Build a mix → cylId map across all plans (shared cylinders)
  const mixToCylId = new Map<string, string>()

  // Collect all unique gases across all plans to suggest cylinders once
  const allGases: { mix: string; isBackGas: boolean }[] = []
  for (const plan of parsed.plans) {
    plan.gases.forEach((mix, idx) => {
      if (!allGases.some(g => g.mix === mix)) {
        allGases.push({ mix, isBackGas: idx === 0 })
      }
    })
  }

  for (const { mix, isBackGas } of allGases) {
    // Try to match to an existing cylinder by mix string (case-insensitive)
    const existing = [...existingCylinders, ...suggestedCylinders].find(
      c => c.mix.toLowerCase() === mix.toLowerCase()
    )
    if (existing) {
      mixToCylId.set(mix, existing.id)
      continue
    }

    if (!seenMixes.has(mix)) {
      seenMixes.add(mix)
      const newCyl: Cylinder = {
        id: uid(),
        label: isBackGas ? `Back gas (${mix})` : `Stage (${mix})`,
        type: isBackGas ? 'back_gas' : 'stage',
        mix,
        ratedVolume: isBackGas ? 100 : 80,
        ratedPressure: isBackGas ? 3442 : 3000,
        count: isBackGas ? 2 : 1,
        refillBetweenDives: isBackGas,
      }
      suggestedCylinders.push(newCyl)
      mixToCylId.set(mix, newCyl.id)
      warnings.push(`No matching cylinder for ${mix} — will add "${newCyl.label}" to Equipment`)
    }
  }

  const dives: DivePlan[] = []

  for (const plan of parsed.plans) {
    const profileRows: ProfileRow[] = plan.rows.map(r => ({
      id: uid(),
      depth: r.depth,
      arriveMin: r.arriveMin,
      stopMin: r.stopMin,
      cylId: mixToCylId.get(r.mix) ?? '',
    })).filter(r => r.cylId !== '')

    if (profileRows.length === 0) {
      warnings.push(`${plan.name}: could not map any rows to cylinders`)
      continue
    }

    const result = computePhasesFromProfile(profileRows, sacCfm, transitRateFtMin)
    if (!result) {
      warnings.push(`${plan.name}: could not compute gas phases`)
      continue
    }

    dives.push({
      id: uid(),
      label: plan.name,
      bottomDepth: result.bottomDepth,
      bottomTime: result.bottomTime,
      totalRuntime: result.totalRuntime,
      turnPressure: 2000,
      gasPhases: result.phases,
    })
  }

  return { dives, suggestedCylinders, warnings }
}
