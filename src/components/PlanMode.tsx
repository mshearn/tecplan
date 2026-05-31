import { useState } from 'react'
import type { DiveDay, Cylinder, DivePlan, GasPhase } from '../types'
import { simulateDiveDay } from '../lib/simulation'
import { uid } from '../lib/storage'
import { fmt } from '../lib/gas'
import { extractXml, parseSubsurfaceXml } from '../lib/subsurface'
import type { SubsurfaceImportResult } from '../lib/subsurface'
import { Badge } from './Badge'

interface Props {
  day: DiveDay
  onChange: (day: DiveDay) => void
  onStartChecklist: (diveIndex: number) => void
}

export function PlanMode({ day, onChange, onStartChecklist }: Props) {
  const simulation = simulateDiveDay(day)
  const allFeasible = simulation.every(s => s.feasible)

  return (
    <div className="plan-mode">
      <section className="card">
        <h2>Dive Day</h2>
        <div className="row-2">
          <div className="field">
            <label>Title</label>
            <input
              value={day.title}
              onChange={e => onChange({ ...day, title: e.target.value })}
              placeholder="e.g. Oriskany liveaboard, Oil rigs trip"
            />
          </div>
          <div className="field">
            <label>Date</label>
            <input
              type="date"
              value={day.date}
              onChange={e => onChange({ ...day, date: e.target.value })}
            />
          </div>
        </div>
        <div className="row-2">
          <div className="field">
            <label>Diver 1 (you)</label>
            <input
              value={day.diver1}
              onChange={e => onChange({ ...day, diver1: e.target.value })}
              placeholder="Your name"
            />
          </div>
          <div className="field">
            <label>Dive buddy</label>
            <input
              value={day.diver2}
              onChange={e => onChange({ ...day, diver2: e.target.value })}
              placeholder="Buddy's name"
            />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Equipment</h2>
        <p className="subtitle">
          Cylinders at their starting pressure for the day. Back gas defaults to refilling
          between dives (boat fill); stage bottles carry over.
        </p>
        <CylinderList cylinders={day.cylinders} onChange={cyls => onChange({ ...day, cylinders: cyls })} />
      </section>

      <section className="card">
        <h2>Dive Sequence</h2>
        <p className="subtitle">
          Add dives in planned order. The tool simulates gas drawdown across the full
          sequence so you can confirm everything is feasible before leaving the dock.
        </p>
        <DiveSequence
          day={day}
          simulation={simulation}
          onChange={dives => onChange({ ...day, dives })}
          onStartChecklist={onStartChecklist}
          onUpdateDay={onChange}
        />
      </section>

      {simulation.length > 0 && (
        <div className={`sequence-summary ${allFeasible ? 'summary-ok' : 'summary-short'}`}>
          {allFeasible
            ? '✓ Dive sequence is feasible with current equipment.'
            : '⚠ Sequence has gas shortfalls — resolve before leaving the dock.'}
        </div>
      )}
    </div>
  )
}

function CylinderList({ cylinders, onChange }: { cylinders: Cylinder[], onChange: (c: Cylinder[]) => void }) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  function remove(id: string) { onChange(cylinders.filter(c => c.id !== id)) }
  function add(cyl: Cylinder) { onChange([...cylinders, cyl]); setAdding(false) }
  function save(cyl: Cylinder) { onChange(cylinders.map(c => c.id === cyl.id ? cyl : c)); setEditingId(null) }

  return (
    <div>
      {cylinders.map(cyl => (
        editingId === cyl.id
          ? <CylinderForm key={cyl.id} initial={cyl} onSave={save} onCancel={() => setEditingId(null)} />
          : (
            <div key={cyl.id} className="cyl-row">
              <div className="cyl-icon">{cyl.type === 'back_gas' ? 'BG' : 'S'}</div>
              <div className="cyl-info">
                <strong>{cyl.label}</strong>
                <span className="cyl-meta">
                  {cyl.count > 1 ? `${cyl.count}× ` : ''}{cyl.ratedVolume} ft³ · {cyl.ratedPressure} PSI · {cyl.mix}
                </span>
                <span className="cyl-meta">
                  Total rated: {fmt(cyl.ratedVolume * cyl.count)} ft³
                  {' · '}{cyl.refillBetweenDives ? 'Refills between dives' : 'Carries over between dives'}
                </span>
              </div>
              <button className="btn-ghost btn-sm" onClick={() => setEditingId(cyl.id)}>edit</button>
              <button className="btn-ghost btn-sm" onClick={() => remove(cyl.id)}>remove</button>
            </div>
          )
      ))}
      {adding
        ? <CylinderForm onSave={add} onCancel={() => setAdding(false)} />
        : <button className="btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setAdding(true)}>+ Add cylinder</button>
      }
    </div>
  )
}

function CylinderForm({
  initial, onSave, onCancel,
}: { initial?: Cylinder, onSave: (c: Cylinder) => void, onCancel: () => void }) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [type, setType] = useState<'back_gas' | 'stage'>(initial?.type ?? 'back_gas')
  const [mix, setMix] = useState(initial?.mix ?? 'Air')
  const [ratedVolume, setRatedVolume] = useState(initial?.ratedVolume ?? 80)
  const [ratedPressure, setRatedPressure] = useState(initial?.ratedPressure ?? 3000)
  const [count, setCount] = useState(initial?.count ?? 1)
  const [refill, setRefill] = useState(initial?.refillBetweenDives ?? (initial?.type !== 'stage'))

  // When type changes, update refill default
  function handleTypeChange(t: 'back_gas' | 'stage') {
    setType(t)
    if (!initial) setRefill(t === 'back_gas')
  }

  function save() {
    if (!label.trim()) return
    onSave({
      id: initial?.id ?? uid(),
      label: label.trim(),
      type,
      mix,
      ratedVolume,
      ratedPressure,
      count,
      refillBetweenDives: refill,
    })
  }

  return (
    <div className="form-inline">
      <div className="row-2">
        <div className="field">
          <label>Label</label>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Back gas, Stage 1 EAN50" />
        </div>
        <div className="field">
          <label>Type</label>
          <select value={type} onChange={e => handleTypeChange(e.target.value as 'back_gas' | 'stage')}>
            <option value="back_gas">Back gas</option>
            <option value="stage">Stage</option>
          </select>
        </div>
      </div>
      <div className="row-4">
        <div className="field">
          <label>Mix</label>
          <input value={mix} onChange={e => setMix(e.target.value)} placeholder="Air, EAN50, O2…" />
        </div>
        <div className="field">
          <label>Rated vol (ft³) <span className="hint-inline">labeled size, e.g. 80 for AL80</span></label>
          <input type="number" value={ratedVolume} onChange={e => setRatedVolume(Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Rated PSI</label>
          <input type="number" value={ratedPressure} onChange={e => setRatedPressure(Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Count <span className="hint-inline">2 = doubles</span></label>
          <input type="number" min={1} max={2} value={count} onChange={e => setCount(Number(e.target.value))} />
        </div>
      </div>
      <div className="field">
        <label className="checkbox-label">
          <input type="checkbox" checked={refill} onChange={e => setRefill(e.target.checked)} />
          {' '}Refill to rated pressure between dives
          <span className="hint-inline"> — check for back gas on a boat; uncheck for stage bottles you carry over</span>
        </label>
      </div>
      <div className="form-actions">
        <button className="btn" onClick={save}>{initial ? 'Save' : 'Add cylinder'}</button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function DiveSequence({
  day, simulation, onChange, onStartChecklist, onUpdateDay,
}: {
  day: DiveDay
  simulation: ReturnType<typeof simulateDiveDay>
  onChange: (dives: DivePlan[]) => void
  onStartChecklist: (i: number) => void
  onUpdateDay: (day: DiveDay) => void
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loggingId, setLoggingId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)

  function remove(id: string) { onChange(day.dives.filter(d => d.id !== id)) }

  function add(dive: DivePlan) { onChange([...day.dives, dive]); setAdding(false) }

  function save(dive: DivePlan) {
    onChange(day.dives.map(d => d.id === dive.id ? dive : d))
    setEditingId(null)
  }

  function savePostDive(diveId: string, pressures: Record<string, number>) {
    onUpdateDay({
      ...day,
      postDivePressures: { ...(day.postDivePressures ?? {}), [diveId]: pressures },
    })
    setLoggingId(null)
  }

  function confirmImport(result: SubsurfaceImportResult) {
    onUpdateDay({
      ...day,
      cylinders: [...day.cylinders, ...result.suggestedCylinders],
      dives: [...day.dives, ...result.dives],
    })
    setShowImport(false)
  }

  return (
    <div>
      {day.dives.map((dive, i) => {
        const sim = simulation[i]
        const signedOff = (day.signOffs ?? []).find(s => s.diveId === dive.id)

        if (editingId === dive.id) {
          return (
            <div key={dive.id} className="dive-row">
              <div className="dive-header"><span className="dive-num">Dive {i + 1}</span><strong>Editing…</strong></div>
              <DivePlanForm cylinders={day.cylinders} initial={dive} onSave={save} onCancel={() => setEditingId(null)} />
            </div>
          )
        }

        return (
          <div key={dive.id} className="dive-row">
            <div className="dive-header">
              <span className="dive-num">Dive {i + 1}</span>
              <strong>{dive.label}</strong>
              <span className="dive-meta">{dive.bottomDepth} ft · {dive.totalRuntime} min runtime</span>
              {sim && (
                <span className={`feasibility ${sim.feasible ? 'feasible-ok' : 'feasible-short'}`}>
                  {sim.feasible ? 'Feasible' : 'GAS SHORTFALL'}
                </span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn-ghost btn-sm" onClick={() => setEditingId(dive.id)}>edit</button>
                <button className="btn-ghost btn-sm" onClick={() => remove(dive.id)}>remove</button>
              </div>
            </div>

            {sim && (
              <table className="sim-table">
                <thead>
                  <tr>
                    <th>Cylinder</th>
                    <th>Start ft³</th>
                    <th>Required</th>
                    <th>Remaining</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {day.cylinders.map(cyl => {
                    const start = sim.startVolumes[cyl.id] ?? 0
                    const req = sim.requiredVolumes[cyl.id] ?? 0
                    const rem = sim.remainingVolumes[cyl.id] ?? 0
                    if (req === 0) return null
                    const marginPct = (start - req) / req
                    return (
                      <tr key={cyl.id}>
                        <td>{cyl.label} ({cyl.mix})</td>
                        <td>{fmt(start)} ft³</td>
                        <td>{fmt(req)} ft³</td>
                        <td className={rem < 0 ? 'text-short' : ''}>{fmt(Math.max(0, rem))} ft³</td>
                        <td><Badge status={marginPct < 0 ? 'short' : marginPct < 0.2 ? 'low' : 'ok'} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {loggingId === dive.id && (
              <PostDiveForm
                dive={dive}
                cylinders={day.cylinders}
                existing={(day.postDivePressures ?? {})[dive.id]}
                onSave={p => savePostDive(dive.id, p)}
                onCancel={() => setLoggingId(null)}
              />
            )}

            <div className="dive-actions">
              {signedOff ? (
                <>
                  <span className="signoff-badge">✓ Signed off — {signedOff.diver1} & {signedOff.diver2}</span>
                  {loggingId !== dive.id && (
                    <button className="btn-ghost btn-sm" onClick={() => setLoggingId(dive.id)}>
                      Record post-dive pressures
                    </button>
                  )}
                </>
              ) : (
                <button className="btn btn-sm" onClick={() => onStartChecklist(i)}>
                  Start checklist for Dive {i + 1} →
                </button>
              )}
            </div>
          </div>
        )
      })}

      {showImport && (
        <SubsurfaceImportPanel
          day={day}
          onImport={confirmImport}
          onCancel={() => setShowImport(false)}
        />
      )}

      {adding
        ? <DivePlanForm cylinders={day.cylinders} onSave={add} onCancel={() => setAdding(false)} />
        : !showImport && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn-ghost btn-sm" onClick={() => setAdding(true)}>+ Add dive</button>
            <button className="btn-ghost btn-sm" onClick={() => setShowImport(true)}>↓ Import from Subsurface</button>
          </div>
        )
      }
    </div>
  )
}

// ─── Profile-based gas calculator ────────────────────────────────────────────

interface ProfileRow {
  id: string
  depth: number      // ft
  arriveMin: number  // cumulative minutes from dive start (DM5 "Dive time")
  stopMin: number    // minutes at this depth (DM5 "Stop time")
  cylId: string
}

function computePhasesFromProfile(
  rows: ProfileRow[],
  sacCfm: number,
  transitRateFtMin: number,
  cylinders: Cylinder[],
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
    // Stop at this depth
    if (row.stopMin > 0) {
      acc(row.cylId, sacCfm * row.stopMin * (row.depth / 33 + 1), row.stopMin, row.depth)
    }
    // Transit to next row — uses current row's gas
    if (i < sorted.length - 1) {
      const next = sorted[i + 1]
      const listedDur = next.arriveMin - (row.arriveMin + row.stopMin)
      const depthChange = Math.abs(next.depth - row.depth)
      // DM5 rounds to whole minutes at 60 ft/min, so a 30 ft transit appears as 0 min.
      // When the table shows 0 but depths differ, infer actual transit time from the rate.
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

function ProfileCalculator({
  cylinders,
  onCompute,
  onCancel,
}: {
  cylinders: Cylinder[]
  onCompute: (phases: GasPhase[], bottomDepth: number, bottomTime: number, totalRuntime: number) => void
  onCancel: () => void
}) {
  const [sacCfm, setSacCfm] = useState(0.75)
  const [transitRate, setTransitRate] = useState(60)  // ft/min
  const [rows, setRows] = useState<ProfileRow[]>([
    { id: uid(), depth: 0, arriveMin: 0, stopMin: 0, cylId: cylinders[0]?.id ?? '' },
  ])
  const [error, setError] = useState<string | null>(null)

  function addRow() {
    setRows(prev => [...prev, { id: uid(), depth: 0, arriveMin: 0, stopMin: 0, cylId: cylinders[0]?.id ?? '' }])
  }

  function updateRow(id: string, patch: Partial<ProfileRow>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  function calculate() {
    setError(null)
    const result = computePhasesFromProfile(rows, sacCfm, transitRate, cylinders)
    if (!result || result.phases.length === 0) {
      setError('Could not compute phases — check that depths, times, and SAC rate are filled in')
      return
    }
    onCompute(result.phases, result.bottomDepth, result.bottomTime, result.totalRuntime)
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Depth profile calculator</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <label style={{ color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            SAC rate (ft³/min)
          </label>
          <input
            type="number"
            step="0.05"
            value={sacCfm}
            onChange={e => setSacCfm(Number(e.target.value))}
            style={{ width: 70, border: '1px solid #ccc', borderRadius: 4, padding: '4px 8px', fontSize: 13, background: '#fafafa' }}
          />
          <span style={{ color: '#aaa', fontSize: 11 }}>≈ {Math.round(sacCfm / 0.035316)} L/min</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <label style={{ color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
            Transit rate (ft/min)
          </label>
          <input
            type="number"
            value={transitRate}
            onChange={e => setTransitRate(Number(e.target.value))}
            style={{ width: 70, border: '1px solid #ccc', borderRadius: 4, padding: '4px 8px', fontSize: 13, background: '#fafafa' }}
          />
          <span style={{ color: '#aaa', fontSize: 11 }}>used when table shows 0 min transit</span>
        </div>
      </div>

      <p className="subtitle" style={{ marginBottom: 8 }}>
        Enter rows from your DM5 plan table — Depth, Dive time (arrive), Stop time, Cylinder.
        Bottom depth, runtime, and gas volumes will be auto-filled.
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: '4px 6px', color: '#888', textTransform: 'uppercase', fontSize: 11 }}>Depth (ft)</th>
              <th style={{ textAlign: 'left', padding: '4px 6px', color: '#888', textTransform: 'uppercase', fontSize: 11 }}>Arrive (min)</th>
              <th style={{ textAlign: 'left', padding: '4px 6px', color: '#888', textTransform: 'uppercase', fontSize: 11 }}>Stop (min)</th>
              <th style={{ textAlign: 'left', padding: '4px 6px', color: '#888', textTransform: 'uppercase', fontSize: 11 }}>Cylinder</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <td style={{ padding: '3px 6px' }}>
                  <input
                    type="number"
                    value={row.depth}
                    onChange={e => updateRow(row.id, { depth: Number(e.target.value) })}
                    style={{ width: 70, border: '1px solid #ccc', borderRadius: 4, padding: '4px 6px', fontSize: 13, background: '#fafafa' }}
                  />
                </td>
                <td style={{ padding: '3px 6px' }}>
                  <input
                    type="number"
                    value={row.arriveMin}
                    onChange={e => updateRow(row.id, { arriveMin: Number(e.target.value) })}
                    style={{ width: 70, border: '1px solid #ccc', borderRadius: 4, padding: '4px 6px', fontSize: 13, background: '#fafafa' }}
                  />
                </td>
                <td style={{ padding: '3px 6px' }}>
                  <input
                    type="number"
                    value={row.stopMin}
                    onChange={e => updateRow(row.id, { stopMin: Number(e.target.value) })}
                    style={{ width: 70, border: '1px solid #ccc', borderRadius: 4, padding: '4px 6px', fontSize: 13, background: '#fafafa' }}
                  />
                </td>
                <td style={{ padding: '3px 6px' }}>
                  <select
                    value={row.cylId}
                    onChange={e => updateRow(row.id, { cylId: e.target.value })}
                    style={{ border: '1px solid #ccc', borderRadius: 4, padding: '4px 6px', fontSize: 13, background: '#fafafa' }}
                  >
                    {cylinders.map(c => (
                      <option key={c.id} value={c.id}>{c.label} ({c.mix})</option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: '3px 6px' }}>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => removeRow(row.id)}
                    style={{ padding: '2px 8px' }}
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="btn-ghost btn-sm" onClick={addRow} style={{ marginTop: 6 }}>+ Add row</button>

      {error && <div className="alert alert-short" style={{ marginTop: 8 }}>{error}</div>}

      <div className="form-actions">
        <button className="btn" onClick={calculate}>Calculate phases</button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ─── DivePlanForm ─────────────────────────────────────────────────────────────

function DivePlanForm({
  cylinders, initial, onSave, onCancel,
}: { cylinders: Cylinder[], initial?: DivePlan, onSave: (d: DivePlan) => void, onCancel: () => void }) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [depth, setDepth] = useState(initial?.bottomDepth ?? 100)
  const [bottomTime, setBottomTime] = useState(initial?.bottomTime ?? 20)
  const [runtime, setRuntime] = useState(initial?.totalRuntime ?? 60)
  const [turnPressure, setTurnPressure] = useState(initial?.turnPressure ?? 2000)
  const [phases, setPhases] = useState<GasPhase[]>(initial?.gasPhases ?? [])
  const [addingPhase, setAddingPhase] = useState(false)
  const [showProfileCalc, setShowProfileCalc] = useState(false)

  function addPhase(p: GasPhase) { setPhases([...phases, p]); setAddingPhase(false) }
  function removePhase(id: string) { setPhases(phases.filter(p => p.id !== id)) }

  function handleProfileCompute(
    computedPhases: GasPhase[],
    bottomDepth: number,
    bt: number,
    rt: number,
  ) {
    setPhases(computedPhases)
    setDepth(bottomDepth)
    setBottomTime(bt)
    setRuntime(rt)
    setShowProfileCalc(false)
  }

  function save() {
    if (!label.trim() || phases.length === 0) return
    onSave({
      id: initial?.id ?? uid(),
      label: label.trim(),
      bottomDepth: depth,
      bottomTime,
      totalRuntime: runtime,
      turnPressure,
      gasPhases: phases,
    })
  }

  return (
    <div className="form-inline">
      <div className="row-2">
        <div className="field">
          <label>Dive label</label>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Olympic - 100 ft" />
        </div>
        <div className="field">
          <label>
            Turn pressure (PSI)
            <span className="hint-inline"> — back gas PSI at which you end the bottom phase and begin ascent (rule of thirds = 1/3 of starting PSI)</span>
          </label>
          <input type="number" value={turnPressure} onChange={e => setTurnPressure(Number(e.target.value))} />
        </div>
      </div>
      <div className="row-3">
        <div className="field">
          <label>Bottom depth (ft)</label>
          <input type="number" value={depth} onChange={e => setDepth(Number(e.target.value))} />
        </div>
        <div className="field">
          <label>
            Bottom time (min)
            <span className="hint-inline"> — time from entry to start of ascent</span>
          </label>
          <input type="number" value={bottomTime} onChange={e => setBottomTime(Number(e.target.value))} />
        </div>
        <div className="field">
          <label>
            Total runtime (min)
            <span className="hint-inline"> — entry to surface, including all deco stops</span>
          </label>
          <input type="number" value={runtime} onChange={e => setRuntime(Number(e.target.value))} />
        </div>
      </div>

      <div className="section-label">Gas phases</div>
      {phases.map((p) => {
        const cyl = cylinders.find(c => c.id === p.cylinderId)
        return (
          <div key={p.id} className="phase-row">
            <span className="phase-cyl">{cyl?.label ?? '?'} ({cyl?.mix})</span>
            <span className="phase-depth">{p.displayDepth || '—'}</span>
            <span>{p.duration} min</span>
            <span>{fmt(p.requiredVolume)} ft³ required</span>
            <button className="btn-ghost btn-sm" onClick={() => removePhase(p.id)}>×</button>
          </div>
        )
      })}

      {showProfileCalc ? (
        <ProfileCalculator
          cylinders={cylinders}
          onCompute={handleProfileCompute}
          onCancel={() => setShowProfileCalc(false)}
        />
      ) : addingPhase ? (
        <GasPhaseForm cylinders={cylinders} onSave={addPhase} onCancel={() => setAddingPhase(false)} />
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <button className="btn-ghost btn-sm" onClick={() => setAddingPhase(true)}>+ Add gas phase</button>
          {cylinders.length > 0 && (
            <button className="btn-ghost btn-sm" onClick={() => setShowProfileCalc(true)}>
              ↗ Compute from depth profile (DM5 / deco table)
            </button>
          )}
        </div>
      )}

      <div className="form-actions" style={{ marginTop: 14 }}>
        <button className="btn" onClick={save} disabled={!label.trim() || phases.length === 0}>
          {initial ? 'Save dive' : 'Add dive'}
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function GasPhaseForm({
  cylinders, onSave, onCancel,
}: { cylinders: Cylinder[], onSave: (p: GasPhase) => void, onCancel: () => void }) {
  const [cylinderId, setCylinderId] = useState(cylinders[0]?.id ?? '')
  const [displayDepth, setDisplayDepth] = useState('')
  const [duration, setDuration] = useState(0)
  const [requiredVolume, setRequiredVolume] = useState(0)

  function save() {
    if (!cylinderId || requiredVolume <= 0) return
    onSave({ id: uid(), cylinderId, displayDepth, duration, requiredVolume })
  }

  return (
    <div className="form-inline form-compact">
      <div className="row-4">
        <div className="field">
          <label>Cylinder</label>
          <select value={cylinderId} onChange={e => setCylinderId(e.target.value)}>
            {cylinders.map(c => <option key={c.id} value={c.id}>{c.label} ({c.mix})</option>)}
          </select>
        </div>
        <div className="field">
          <label>
            Depth label
            <span className="hint-inline"> — e.g. "72 ft stop", shown on checklist</span>
          </label>
          <input value={displayDepth} onChange={e => setDisplayDepth(e.target.value)} placeholder="72 ft stop" />
        </div>
        <div className="field">
          <label>Duration (min)</label>
          <input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} />
        </div>
        <div className="field">
          <label>
            Vol required (ft³)
            <span className="hint-inline"> — from deco plan output</span>
          </label>
          <input type="number" step="0.1" value={requiredVolume} onChange={e => setRequiredVolume(Number(e.target.value))} />
        </div>
      </div>
      <div className="form-actions">
        <button className="btn btn-sm" onClick={save}>Add phase</button>
        <button className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function SubsurfaceImportPanel({
  day, onImport, onCancel,
}: {
  day: DiveDay
  onImport: (result: SubsurfaceImportResult) => void
  onCancel: () => void
}) {
  const [result, setResult] = useState<SubsurfaceImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const xml = await extractXml(file)
      setResult(parseSubsurfaceXml(xml, day.cylinders))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file')
    } finally {
      setLoading(false)
    }
  }

  if (!result) {
    return (
      <div className="form-inline">
        <strong>Import from Subsurface</strong>
        <p className="subtitle" style={{ marginTop: 4, marginBottom: 12 }}>
          Export your dive plan from Subsurface: File → Export → Subsurface XML.
          Accepts .ssrm (project file) or .xml.
          Gas volumes are calculated from your plan's SAC rates and segment depths.
        </p>
        <input
          type="file"
          accept=".ssrm,.xml"
          onChange={handleFile}
          disabled={loading}
          style={{ fontSize: 13 }}
        />
        {loading && <p className="subtitle" style={{ marginTop: 8 }}>Parsing…</p>}
        {error && <div className="alert alert-short" style={{ marginTop: 10 }}>{error}</div>}
        <div className="form-actions">
          <button className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    )
  }

  const allCylinders = [...day.cylinders, ...result.suggestedCylinders]

  return (
    <div className="form-inline">
      <strong>Import preview — {result.dives.length} dive{result.dives.length !== 1 ? 's' : ''} found</strong>

      {result.suggestedCylinders.length > 0 && (
        <p className="subtitle" style={{ marginTop: 4 }}>
          Will also add to Equipment:{' '}
          {result.suggestedCylinders.map(c => `${c.label} (${c.mix})`).join(', ')}
        </p>
      )}

      {result.warnings.length > 0 && (
        <div style={{ margin: '8px 0', padding: '8px 12px', background: '#fff8e1', border: '1px solid #f0d060', borderRadius: 4, fontSize: 12 }}>
          {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {result.dives.map(dive => (
        <div key={dive.id} className="dive-row" style={{ marginTop: 10 }}>
          <div className="dive-header">
            <strong>{dive.label}</strong>
            <span className="dive-meta">{dive.bottomDepth} ft · {dive.totalRuntime} min runtime · turn {dive.turnPressure} PSI</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', fontSize: 12, marginTop: 4 }}>
            {dive.gasPhases.map((p, i) => {
              const cyl = allCylinders.find(c => c.id === p.cylinderId)
              return (
                <span key={i}>
                  <strong>{cyl?.label ?? '?'}</strong> ({cyl?.mix}): {fmt(p.requiredVolume)} ft³ · {p.displayDepth}
                </span>
              )
            })}
          </div>
        </div>
      ))}

      <div className="form-actions">
        <button className="btn" onClick={() => onImport(result)}>
          Import {result.dives.length} dive{result.dives.length !== 1 ? 's' : ''}
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function PostDiveForm({
  dive, cylinders, existing, onSave, onCancel,
}: {
  dive: DivePlan
  cylinders: Cylinder[]
  existing?: Record<string, number>
  onSave: (pressures: Record<string, number>) => void
  onCancel: () => void
}) {
  const usedCylIds = new Set(dive.gasPhases.map(p => p.cylinderId))
  const usedCyls = cylinders.filter(c => usedCylIds.has(c.id))
  const [pressures, setPressures] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    for (const c of usedCyls) init[c.id] = existing?.[c.id] ?? 0
    return init
  })

  return (
    <div className="form-inline" style={{ marginTop: 10 }}>
      <p className="subtitle">Enter actual gauge readings after the dive. Stage pressures will carry forward to the next dive.</p>
      <div className="row-2">
        {usedCyls.map(c => (
          <div key={c.id} className="field">
            <label>{c.label} ({c.mix}) — post-dive PSI</label>
            <input
              type="number"
              value={pressures[c.id] ?? 0}
              onChange={e => setPressures(prev => ({ ...prev, [c.id]: Number(e.target.value) }))}
            />
          </div>
        ))}
      </div>
      <div className="form-actions">
        <button className="btn btn-sm" onClick={() => onSave(pressures)}>Save</button>
        <button className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
