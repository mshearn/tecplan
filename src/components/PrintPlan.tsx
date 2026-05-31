import type { DiveDay, DivePlan } from '../types'
import { simulateDiveDay } from '../lib/simulation'
import { fmt } from '../lib/gas'

interface Props {
  day: DiveDay
}

export function PrintPlan({ day }: Props) {
  const simulation = simulateDiveDay(day)

  return (
    <div className="print-only">
      <div className="print-header">
        <div className="print-title">TecPlan — Pre-Dive Plan</div>
        <div className="print-meta">
          <span>{day.title || 'Untitled dive day'}</span>
          <span>{day.date}</span>
          <span>Diver 1: {day.diver1 || '_______________'}</span>
          <span>Diver 2: {day.diver2 || '_______________'}</span>
        </div>
      </div>

      <section className="print-section">
        <h2 className="print-section-title">Equipment</h2>
        <table className="print-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Label</th>
              <th>Mix</th>
              <th>Rated vol</th>
              <th>Rated PSI</th>
              <th>Between dives</th>
            </tr>
          </thead>
          <tbody>
            {day.cylinders.map(cyl => (
              <tr key={cyl.id}>
                <td>{cyl.type === 'back_gas' ? 'Back gas' : 'Stage'}</td>
                <td>{cyl.label}</td>
                <td>{cyl.mix}</td>
                <td>{cyl.count > 1 ? `${cyl.count}× ` : ''}{cyl.ratedVolume} ft³</td>
                <td>{cyl.ratedPressure} PSI</td>
                <td>{cyl.refillBetweenDives ? 'Refill' : 'Carry over'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {day.dives.map((dive, i) => (
        <DivePrintSection
          key={dive.id}
          dive={dive}
          diveIndex={i}
          day={day}
          simVolumes={simulation[i]}
        />
      ))}

      <div className="print-footer">
        Printed from TecPlan · {new Date().toLocaleString()}
      </div>
    </div>
  )
}

function DivePrintSection({
  dive, diveIndex, day, simVolumes,
}: {
  dive: DivePlan
  diveIndex: number
  day: DiveDay
  simVolumes: ReturnType<typeof simulateDiveDay>[number] | undefined
}) {
  const backGas = day.cylinders.find(c => c.type === 'back_gas')

  const checklistItems = [
    `Back gas regulator breathes correctly at surface. Both second stages tested. SPG reads ______ PSI.`,
    ...(backGas && backGas.count > 1 ? ['Isolator valve open and confirmed.'] : []),
    ...day.cylinders
      .filter(c => c.type === 'stage' && dive.gasPhases.some(p => p.cylinderId === c.id))
      .map(c => `${c.label} (${c.mix}) clipped and accessible. SPG reads ______ PSI.`),
    ...dive.gasPhases.filter(p => p.displayDepth).map(p => {
      const cyl = day.cylinders.find(c => c.id === p.cylinderId)
      return `Gas switch: ${cyl?.mix ?? '?'} at ${p.displayDepth}.`
    }),
    `Turn pressure: back gas at ${dive.turnPressure} PSI — both divers confirm.`,
    'Dive computer set to correct gas and gradient factors.',
  ]

  return (
    <section className="print-dive-section">
      <h2 className="print-section-title">
        Dive {diveIndex + 1}: {dive.label}
      </h2>
      <div className="print-dive-summary">
        <span>{dive.bottomDepth} ft bottom depth</span>
        <span>{dive.bottomTime} min bottom time</span>
        <span>{dive.totalRuntime} min total runtime</span>
        <span>Turn pressure: {dive.turnPressure} PSI</span>
      </div>

      <h3 className="print-sub-title">Gas Volumes</h3>
      <table className="print-table">
        <thead>
          <tr>
            <th>Cylinder</th>
            <th>Mix</th>
            <th>Phase</th>
            <th>Required</th>
            <th>Available (rated)</th>
            <th>Margin</th>
          </tr>
        </thead>
        <tbody>
          {dive.gasPhases.map(phase => {
            const cyl = day.cylinders.find(c => c.id === phase.cylinderId)
            if (!cyl) return null
            const available = simVolumes?.startVolumes[cyl.id] ?? (cyl.ratedVolume * cyl.count)
            const margin = available - phase.requiredVolume
            const marginPct = phase.requiredVolume > 0 ? margin / phase.requiredVolume : 1
            return (
              <tr key={phase.id}>
                <td>{cyl.label}</td>
                <td>{cyl.mix}</td>
                <td>{phase.displayDepth}</td>
                <td>{fmt(phase.requiredVolume)} ft³</td>
                <td>{fmt(available)} ft³</td>
                <td style={{ fontWeight: marginPct < 0 ? 700 : undefined }}>
                  {margin >= 0 ? '+' : ''}{fmt(margin)} ft³
                  {' '}({marginPct < 0 ? 'SHORT' : marginPct < 0.2 ? 'LOW' : 'OK'})
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h3 className="print-sub-title">Pre-Dive Checklist</h3>
      <div className="print-checklist">
        {checklistItems.map((item, i) => (
          <div key={i} className="print-check-item">
            <span className="print-checkbox">☐</span>
            <span>{item}</span>
          </div>
        ))}
      </div>

      <div className="print-signoff">
        <div className="print-signoff-row">
          <span>Diver 1: _______________________</span>
          <span>Diver 2: _______________________</span>
          <span>Time: ___________</span>
        </div>
      </div>
    </section>
  )
}
