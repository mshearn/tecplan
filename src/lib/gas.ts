import type { Cylinder, GasPhase, GasPhaseResult, BadgeStatus } from '../types'

const LOW_THRESHOLD = 0.20  // 20% margin = LOW
// margin < 0 = SHORT, 0–20% = LOW, ≥20% = OK

export function availableVolume(cyl: Cylinder, currentPSI: number): number {
  return cyl.ratedVolume * cyl.count * (currentPSI / cyl.ratedPressure)
}

export function badgeStatus(marginPct: number): BadgeStatus {
  if (marginPct < 0) return 'short'
  if (marginPct < LOW_THRESHOLD) return 'low'
  return 'ok'
}

export function evaluatePhase(
  phase: GasPhase,
  cylinder: Cylinder,
  currentPSI: number,
): GasPhaseResult {
  const available = availableVolume(cylinder, currentPSI)
  const margin = available - phase.requiredVolume
  const marginPct = phase.requiredVolume > 0 ? margin / phase.requiredVolume : 1
  return {
    phase,
    cylinder,
    availableVolume: available,
    requiredVolume: phase.requiredVolume,
    marginVolume: margin,
    marginPct,
    status: badgeStatus(marginPct),
  }
}

export function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals)
}
