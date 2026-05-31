export interface Cylinder {
  id: string
  label: string
  type: 'back_gas' | 'stage'
  mix: string
  ratedVolume: number   // ft³ nominal (e.g. 80 for AL80, 100 for HP100)
  ratedPressure: number // PSI
  count: number         // 1 = single, 2 = manifolded doubles
  refillBetweenDives: boolean // true = reset to rated after each dive (boat fill); false = carry over
}

export interface GasPhase {
  id: string
  cylinderId: string
  displayDepth: string  // label only, e.g. "72 ft stop"
  duration: number      // min
  requiredVolume: number // ft³
}

export interface DivePlan {
  id: string
  label: string
  bottomDepth: number   // ft
  bottomTime: number    // min
  totalRuntime: number  // min
  turnPressure: number  // PSI
  gasPhases: GasPhase[]
}

export type BadgeStatus = 'ok' | 'low' | 'short'

export interface GasPhaseResult {
  phase: GasPhase
  cylinder: Cylinder
  availableVolume: number  // ft³ at current PSI
  requiredVolume: number   // ft³
  marginVolume: number     // ft³ surplus (negative = short)
  marginPct: number        // %
  status: BadgeStatus
}

export interface DiveSignOff {
  diveId: string
  timestamp: string
  diver1: string
  diver2: string
  overrideReason?: string
}

export interface DiveDay {
  id: string
  title: string
  date: string
  diver1: string
  diver2: string
  cylinders: Cylinder[]
  dives: DivePlan[]
  // actual post-dive PSI readings, keyed by diveId then cylinderId
  postDivePressures: Record<string, Record<string, number>>
  signOffs: DiveSignOff[]
}

// Plan Mode simulation result for one dive
export interface SimulatedDive {
  diveId: string
  diveLabel: string
  // starting ft³ per cylinder going into this dive
  startVolumes: Record<string, number>
  // required ft³ per cylinder for this dive
  requiredVolumes: Record<string, number>
  // remaining ft³ per cylinder after this dive
  remainingVolumes: Record<string, number>
  phaseResults: GasPhaseResult[]
  feasible: boolean
}
