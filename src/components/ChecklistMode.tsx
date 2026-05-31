import { useState } from 'react'
import type { DiveDay, DivePlan, DiveSignOff, GasPhaseResult } from '../types'
import { evaluatePhase, fmt } from '../lib/gas'

import { Badge } from './Badge'

interface Props {
  day: DiveDay
  diveIndex: number
  onBack: () => void
  onChange: (day: DiveDay) => void
}

type Screen = 'import' | 'equipment' | 'checklist'

export function ChecklistMode({ day, diveIndex, onBack, onChange }: Props) {
  const [screen, setScreen] = useState<Screen>('import')
  // Current PSI per cylinderId for this dive
  const prevDive = diveIndex > 0 ? day.dives[diveIndex - 1] : null
  const prevPostPressures = prevDive ? ((day.postDivePressures ?? {})[prevDive.id] ?? {}) : {}

  const [currentPressures, setCurrentPressures] = useState<Record<string, number>>(() => {
    // Pre-populate from post-dive pressures of the previous dive, or rated pressure
    const init: Record<string, number> = {}
    for (const cyl of day.cylinders) {
      init[cyl.id] = prevPostPressures[cyl.id] ?? cyl.ratedPressure
    }
    return init
  })

  const dive = day.dives[diveIndex]
  if (!dive) return <div className="card"><p>Dive not found.</p><button className="btn-ghost" onClick={onBack}>← Back</button></div>

  const phaseResults: GasPhaseResult[] = dive.gasPhases.map(phase => {
    const cyl = day.cylinders.find(c => c.id === phase.cylinderId)
    if (!cyl) return null
    return evaluatePhase(phase, cyl, currentPressures[cyl.id] ?? cyl.ratedPressure)
  }).filter(Boolean) as GasPhaseResult[]

  const hasShort = phaseResults.some(r => r.status === 'short')

  function updatePressure(cylId: string, psi: number) {
    setCurrentPressures(prev => ({ ...prev, [cylId]: psi }))
  }

  function handleSignOff(diver1: string, diver2: string, overrideReason?: string) {
    const signOff: DiveSignOff = {
      diveId: dive.id,
      timestamp: new Date().toISOString(),
      diver1,
      diver2,
      overrideReason,
    }
    onChange({
      ...day,
      signOffs: [...(day.signOffs ?? []).filter(s => s.diveId !== dive.id), signOff],
    })
  }

const existingSignOff = (day.signOffs ?? []).find(s => s.diveId === dive.id)

  return (
    <div className="checklist-mode">
      <div className="checklist-header">
        <button className="btn-ghost btn-sm" onClick={onBack}>← Plan</button>
        <span>Dive {diveIndex + 1}: {dive.label}</span>
        <div className="screen-tabs">
          {(['import', 'equipment', 'checklist'] as Screen[]).map((s, i) => (
            <button
              key={s}
              className={`screen-tab ${screen === s ? 'active' : ''}`}
              onClick={() => setScreen(s)}
            >
              {i + 1} — {s === 'import' ? 'Deco Plan' : s === 'equipment' ? 'Equipment' : 'Verify'}
            </button>
          ))}
        </div>
      </div>

      {screen === 'import' && (
        <DecoImportScreen dive={dive} onNext={() => setScreen('equipment')} />
      )}
      {screen === 'equipment' && (
        <EquipmentScreen
          day={day}
          dive={dive}
          currentPressures={currentPressures}
          phaseResults={phaseResults}
          onUpdatePressure={updatePressure}
          onNext={() => setScreen('checklist')}
          onBack={() => setScreen('import')}
        />
      )}
      {screen === 'checklist' && (
        <VerificationScreen
          dive={dive}
          day={day}
          phaseResults={phaseResults}
          hasShort={hasShort}
          existingSignOff={existingSignOff}
          onSignOff={handleSignOff}
          onBack={() => setScreen('equipment')}
          currentPressures={currentPressures}
        />
      )}
    </div>
  )
}

function DecoImportScreen({ dive, onNext }: { dive: DivePlan, onNext: () => void }) {
  return (
    <div className="card">
      <h2>Deco Plan</h2>
      <p className="subtitle">
        {dive.bottomDepth} ft · {dive.bottomTime} min bottom · {dive.totalRuntime} min total runtime
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Phase</th>
            <th>Depth</th>
            <th>Duration</th>
            <th>Vol required</th>
          </tr>
        </thead>
        <tbody>
          {dive.gasPhases.map(p => (
            <tr key={p.id}>
              <td>{p.displayDepth || '—'}</td>
              <td>{p.displayDepth}</td>
              <td>{p.duration} min</td>
              <td>{fmt(p.requiredVolume)} ft³</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="field-hint">Turn pressure: {dive.turnPressure} PSI</p>
      <div className="form-actions">
        <button className="btn" onClick={onNext}>Next: Configure Equipment →</button>
      </div>
    </div>
  )
}

function EquipmentScreen({
  day, dive, currentPressures, phaseResults, onUpdatePressure, onNext, onBack,
}: {
  day: DiveDay
  dive: DivePlan
  currentPressures: Record<string, number>
  phaseResults: GasPhaseResult[]
  onUpdatePressure: (id: string, psi: number) => void
  onNext: () => void
  onBack: () => void
}) {
  const usedCylIds = new Set(dive.gasPhases.map(p => p.cylinderId))
  const usedCyls = day.cylinders.filter(c => usedCylIds.has(c.id))
  const hasShort = phaseResults.some(r => r.status === 'short')

  return (
    <div className="card">
      <h2>Equipment Configuration</h2>
      <p className="subtitle">Enter current gauge pressure for each cylinder.</p>

      {usedCyls.map(cyl => {
        const cylResults = phaseResults.filter(r => r.cylinder.id === cyl.id)
        const totalRequired = cylResults.reduce((s, r) => s + r.requiredVolume, 0)
        const currentPSI = currentPressures[cyl.id] ?? cyl.ratedPressure
        const available = cyl.ratedVolume * cyl.count * (currentPSI / cyl.ratedPressure)
        const margin = available - totalRequired
        const marginPct = totalRequired > 0 ? margin / totalRequired : 1
        const status = marginPct < 0 ? 'short' : marginPct < 0.2 ? 'low' : 'ok'

        return (
          <div key={cyl.id} className="cyl-equipment-row">
            <div className="cyl-icon">{cyl.type === 'back_gas' ? 'BG' : 'S'}</div>
            <div className="cyl-info">
              <strong>{cyl.label} — {cyl.mix}</strong>
              <div className="cyl-meta">
                {cyl.count > 1 ? `${cyl.count}× ` : ''}{cyl.ratedVolume} ft³ · rated {cyl.ratedPressure} PSI
              </div>
              <div className="psi-row">
                <label>Current PSI:</label>
                <input
                  type="number"
                  className="psi-input"
                  value={currentPSI}
                  onChange={e => onUpdatePressure(cyl.id, Number(e.target.value))}
                />
                <span className="psi-meta">/ {cyl.ratedPressure} rated</span>
                <span className={`vol-calc ${status === 'short' ? 'text-short' : status === 'low' ? 'text-low' : 'text-ok'}`}>
                  → {fmt(available)} ft³ available vs. {fmt(totalRequired)} ft³ required
                  {' '}({margin >= 0 ? '+' : ''}{fmt(margin)} ft³)
                </span>
              </div>
            </div>
            <Badge status={status} />
          </div>
        )
      })}

      {hasShort && (
        <div className="alert alert-short">
          <strong>⚠ Gas shortfall — resolve before proceeding to sign-off</strong>
        </div>
      )}

      <div className="form-actions">
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn" onClick={onNext}>Next: Verification →</button>
      </div>
    </div>
  )
}

function VerificationScreen({
  dive, day, phaseResults, hasShort, existingSignOff,
  onSignOff, onBack, currentPressures,
}: {
  dive: DivePlan
  day: DiveDay
  phaseResults: GasPhaseResult[]
  hasShort: boolean
  existingSignOff: DiveSignOff | undefined
  onSignOff: (d1: string, d2: string, override?: string) => void
  onBack: () => void
  currentPressures: Record<string, number>
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [diver1, setDiver1] = useState(existingSignOff?.diver1 ?? day.diver1)
  const [diver2, setDiver2] = useState(existingSignOff?.diver2 ?? day.diver2)
  const [showOverride, setShowOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')

  function toggle(key: string) {
    setChecked(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const staticItems = [
    `Back gas regulator breathes correctly at surface. Both second stages tested. SPG reads ${currentPressures[day.cylinders.find(c => c.type === 'back_gas')?.id ?? ''] ?? '—'} PSI.`,
    ...(day.cylinders.find(c => c.type === 'back_gas')?.count ?? 1) > 1 ? ['Isolator valve open.'] : [],
    ...day.cylinders.filter(c => c.type === 'stage' && dive.gasPhases.some(p => p.cylinderId === c.id))
      .map(c => `${c.label} (${c.mix}) clipped and accessible. SPG reads ${currentPressures[c.id] ?? '—'} PSI.`),
    ...dive.gasPhases.filter(p => p.displayDepth).map(p => {
      const cyl = day.cylinders.find(c => c.id === p.cylinderId)
      return `Gas switch: ${cyl?.mix ?? p.cylinderId} at ${p.displayDepth}.`
    }),
    `Turn pressure: back gas at ${dive.turnPressure} PSI — both divers confirm.`,
    'Dive computer set to correct gas and gradient factors.',
  ]

  const allEquipmentChecked = staticItems.length > 0 && staticItems.every((_, i) => checked[`eq-${i}`])
  const canSignOff = diver1.trim().length > 0 && diver2.trim().length > 0 && allEquipmentChecked

  return (
    <div className="card">
      <h2>Pre-Dive Verification</h2>
      <p className="subtitle">Auto-generated from plan and equipment. One diver reads, buddy confirms.</p>

      <div className="section-label">Gas volumes</div>
      {phaseResults.map((r, i) => (
        <div key={i} className={`check-item ${r.status === 'short' ? 'check-short' : ''}`}>
          <div
            className={`check-box ${checked[`gas-${i}`] && r.status !== 'short' ? 'checked' : ''}`}
            onClick={() => r.status !== 'short' && toggle(`gas-${i}`)}
          />
          <div className="check-content">
            <div className={`check-label ${r.status === 'short' ? 'text-short' : ''}`}>
              {r.cylinder.label} ({r.cylinder.mix})
              {r.status === 'short' ? ' — VOLUME SHORTFALL ⚠' : ' — volume confirmed'}
            </div>
            <div className="check-detail">
              {fmt(r.cylinder.ratedVolume * r.cylinder.count)} ft³ @ {currentPressures[r.cylinder.id] ?? r.cylinder.ratedPressure} PSI
              {' '}= {fmt(r.availableVolume)} ft³ available vs. {fmt(r.requiredVolume)} ft³ required
              {' '}for {r.phase.displayDepth}.
              {' '}{r.marginVolume >= 0
                ? `Margin: +${fmt(r.marginVolume)} ft³ (${fmt(r.marginPct * 100)}%).`
                : `Short by ${fmt(Math.abs(r.marginVolume))} ft³. Do not dive until resolved.`}
            </div>
          </div>
          <Badge status={r.status} />
        </div>
      ))}

      <div className="section-label" style={{ marginTop: '1rem' }}>Equipment</div>
      {staticItems.map((item, i) => (
        <div key={i} className="check-item">
          <div
            className={`check-box ${checked[`eq-${i}`] ? 'checked' : ''}`}
            onClick={() => toggle(`eq-${i}`)}
          />
          <div className="check-content">
            <div className="check-label">{item}</div>
          </div>
        </div>
      ))}

      <div className="signoff-area">
        <div className="row-2">
          <div className="field">
            <label>Diver 1</label>
            <input value={diver1} onChange={e => setDiver1(e.target.value)} placeholder="Name" />
          </div>
          <div className="field">
            <label>Diver 2</label>
            <input value={diver2} onChange={e => setDiver2(e.target.value)} placeholder="Name" />
          </div>
        </div>

        {existingSignOff && (
          <div className="alert alert-ok">
            ✓ Signed off by {existingSignOff.diver1} & {existingSignOff.diver2} at{' '}
            {new Date(existingSignOff.timestamp).toLocaleTimeString()}
            {existingSignOff.overrideReason && ` (override: ${existingSignOff.overrideReason})`}
          </div>
        )}

        {hasShort && !existingSignOff && (
          <div className="alert alert-short">
            <strong>Sign-off blocked — gas shortfall unresolved.</strong>
            <button className="btn-ghost btn-sm" style={{ marginLeft: '1rem' }} onClick={() => setShowOverride(!showOverride)}>
              Accept risk and override
            </button>
          </div>
        )}

        {showOverride && hasShort && !existingSignOff && (
          <div className="field">
            <label>Override reason (required)</label>
            <input
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              placeholder="e.g. Shortened bottom time to reduce gas obligation"
            />
            <button
              className="btn btn-warn"
              disabled={!canSignOff || overrideReason.trim().length < 10}
              onClick={() => { onSignOff(diver1, diver2, overrideReason); setShowOverride(false) }}
            >
              Sign off with override
            </button>
          </div>
        )}

        {!hasShort && (
          <button
            className="btn"
            disabled={!canSignOff}
            onClick={() => onSignOff(diver1, diver2)}
          >
            Sign off — go dive
          </button>
        )}
      </div>

      <div className="form-actions" style={{ marginTop: '1rem' }}>
        <button className="btn-ghost" onClick={onBack}>← Back to plan</button>
      </div>
    </div>
  )
}
