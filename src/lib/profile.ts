import type { GasPhase } from '../types'
import { uid } from './storage'

export interface ProfileRow {
  id: string
  depth: number      // ft
  arriveMin: number  // cumulative minutes from dive start (DM5 "Dive time")
  stopMin: number    // minutes at this depth (DM5 "Stop time")
  cylId: string
}

export function computePhasesFromProfile(
  rows: ProfileRow[],
  sacCfm: number,
  transitRateFtMin: number,
): { phases: GasPhase[]; bottomDepth: number; bottomTime: number; totalRuntime: number } | null {
  if (rows.length === 0 || sacCfm <= 0) return null
  const sorted = [...rows].sort((a, b) => a.arriveMin - b.arriveMin)

  const cylVol = new Map<string, number>()
  const cylDur = new Map<string, number>()
  const cylMaxDepth = new Map<string, number>()
  const cylOrder = new Map<string, number>()
  let orderIdx = 0

  function acc(cylId: string, vol: number, dur: number, depth: number) {
    cylVol.set(cylId, (cylVol.get(cylId) ?? 0) + vol)
    cylDur.set(cylId, (cylDur.get(cylId) ?? 0) + dur)
    cylMaxDepth.set(cylId, Math.max(cylMaxDepth.get(cylId) ?? 0, depth))
    if (!cylOrder.has(cylId)) cylOrder.set(cylId, orderIdx++)
  }

  // Descent from surface to first waypoint — uses first row's cylinder
  const first = sorted[0]
  if (first.arriveMin > 0) {
    const avg = first.depth / 2
    acc(first.cylId, sacCfm * first.arriveMin * (avg / 33 + 1), first.arriveMin, first.depth)
  }

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]
    if (row.stopMin > 0) {
      acc(row.cylId, sacCfm * row.stopMin * (row.depth / 33 + 1), row.stopMin, row.depth)
    }
    if (i < sorted.length - 1) {
      const next = sorted[i + 1]
      const listedDur = next.arriveMin - (row.arriveMin + row.stopMin)
      const depthChange = Math.abs(next.depth - row.depth)
      const dur = listedDur > 0 ? listedDur
        : (depthChange > 0 && transitRateFtMin > 0 ? depthChange / transitRateFtMin : 0)
      if (dur > 0) {
        const avg = (row.depth + next.depth) / 2
        const transitDepth = Math.max(row.depth, next.depth)
        acc(row.cylId, sacCfm * dur * (avg / 33 + 1), dur, transitDepth)
      }
    }
  }

  const maxDepth = Math.max(...sorted.map(r => r.depth))
  const deepestRows = sorted.filter(r => r.depth >= maxDepth * 0.9)
  const lastDeep = deepestRows[deepestRows.length - 1]
  const bottomTime = lastDeep ? lastDeep.arriveMin + lastDeep.stopMin : 0

  const last = sorted[sorted.length - 1]
  const totalRuntime = last.arriveMin + last.stopMin

  const phases: GasPhase[] = [...cylVol.entries()]
    .sort((a, b) => (cylOrder.get(a[0]) ?? 0) - (cylOrder.get(b[0]) ?? 0))
    .map(([cylId, vol]) => {
      const maxD = cylMaxDepth.get(cylId) ?? 0
      return {
        id: uid(),
        cylinderId: cylId,
        displayDepth: maxD >= maxDepth * 0.8 ? `${maxDepth} ft bottom` : `${maxD} ft deco`,
        duration: Math.round(cylDur.get(cylId) ?? 0),
        requiredVolume: Math.round(vol * 10) / 10,
      }
    })

  return { phases, bottomDepth: maxDepth, bottomTime: Math.round(bottomTime), totalRuntime: Math.round(totalRuntime) }
}
