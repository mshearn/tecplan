import type { DiveDay, SimulatedDive, GasPhaseResult } from '../types'
import { availableVolume, evaluatePhase } from './gas'

export function simulateDiveDay(day: DiveDay): SimulatedDive[] {
  const results: SimulatedDive[] = []

  // Starting ft³ for each cylinder at rated/full pressure
  const currentVolumes: Record<string, number> = {}
  for (const cyl of day.cylinders) {
    currentVolumes[cyl.id] = cyl.ratedVolume * cyl.count
  }

  for (const dive of day.dives) {
    const startVolumes = { ...currentVolumes }
    const requiredVolumes: Record<string, number> = {}
    const phaseResults: GasPhaseResult[] = []

    // Group required volumes by cylinder
    for (const phase of dive.gasPhases) {
      requiredVolumes[phase.cylinderId] = (requiredVolumes[phase.cylinderId] ?? 0) + phase.requiredVolume
    }

    // Evaluate each phase against current available volume
    for (const phase of dive.gasPhases) {
      const cyl = day.cylinders.find(c => c.id === phase.cylinderId)
      if (!cyl) continue
      // Compute PSI equivalent of current volume for this cylinder
      const currentPSI = (currentVolumes[cyl.id] ?? 0) / (cyl.ratedVolume * cyl.count) * cyl.ratedPressure
      phaseResults.push(evaluatePhase(phase, cyl, currentPSI))
    }

    const feasible = phaseResults.every(r => r.status !== 'short')

    // Deduct required volumes (even if short, to propagate realistic state)
    const remainingVolumes = { ...currentVolumes }
    for (const [cylId, req] of Object.entries(requiredVolumes)) {
      remainingVolumes[cylId] = Math.max(0, (remainingVolumes[cylId] ?? 0) - req)
    }

    results.push({
      diveId: dive.id,
      diveLabel: dive.label,
      startVolumes,
      requiredVolumes,
      remainingVolumes,
      phaseResults,
      feasible,
    })

    // Next dive starts where this one ended.
    // If actual post-dive pressures were recorded, use those.
    // Otherwise: refill cylinders marked refillBetweenDives (back gas on a boat),
    // carry over cylinders that aren't (stage bottles).
    const actual = (day.postDivePressures ?? {})[dive.id]
    for (const cyl of day.cylinders) {
      if (actual?.[cyl.id] !== undefined) {
        currentVolumes[cyl.id] = availableVolume(cyl, actual[cyl.id])
      } else if (cyl.refillBetweenDives) {
        currentVolumes[cyl.id] = cyl.ratedVolume * cyl.count  // topped off
      } else {
        currentVolumes[cyl.id] = remainingVolumes[cyl.id] ?? 0
      }
    }
  }

  return results
}
