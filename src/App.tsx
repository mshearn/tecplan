import { useState, useEffect } from 'react'
import type { DiveDay } from './types'
import { loadDays, upsertDay, deleteDay, uid } from './lib/storage'
import { PlanMode } from './components/PlanMode'
import { ChecklistMode } from './components/ChecklistMode'
import './App.css'

type View =
  | { mode: 'home' }
  | { mode: 'plan'; dayId: string }
  | { mode: 'checklist'; dayId: string; diveIndex: number }

function newDay(): DiveDay {
  return {
    id: uid(),
    title: '',
    date: new Date().toISOString().slice(0, 10),
    diver1: '',
    diver2: '',
    cylinders: [],
    dives: [],
    postDivePressures: {},
    signOffs: [],
  }
}

export default function App() {
  const [days, setDays] = useState<DiveDay[]>([])
  const [view, setView] = useState<View>({ mode: 'home' })

  useEffect(() => {
    setDays(loadDays())
  }, [])

  function updateDay(day: DiveDay) {
    upsertDay(day)
    setDays(loadDays())
  }

  function removeDay(id: string) {
    deleteDay(id)
    setDays(loadDays())
  }

  function createDay() {
    const day = newDay()
    upsertDay(day)
    setDays(loadDays())
    setView({ mode: 'plan', dayId: day.id })
  }

  if (view.mode === 'home') {
    return (
      <div className="app">
        <header className="app-header">
          <h1>TecPlan</h1>
          <span className="header-sub">Technical dive planning & verification</span>
        </header>
        <main className="home">
          {days.length === 0 ? (
            <div className="empty-state">
              <p>No dive days yet.</p>
              <button className="btn" onClick={createDay}>+ New dive day</button>
            </div>
          ) : (
            <>
              <div className="day-list">
                {days.map(day => (
                  <div key={day.id} className="day-card" onClick={() => setView({ mode: 'plan', dayId: day.id })}>
                    <div className="day-card-main">
                      <strong>{day.title || 'Untitled dive day'}</strong>
                      <span className="day-date">{day.date}</span>
                    </div>
                    <span>{day.dives.length} dive{day.dives.length !== 1 ? 's' : ''}</span>
                    <span>{day.cylinders.length} cylinder{day.cylinders.length !== 1 ? 's' : ''}</span>
                    <button
                      className="btn-ghost btn-sm day-delete"
                      onClick={e => {
                        e.stopPropagation()
                        if (confirm(`Delete "${day.title || 'Untitled dive day'}"? This cannot be undone.`)) {
                          removeDay(day.id)
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
              <button className="btn" onClick={createDay}>+ New dive day</button>
            </>
          )}
        </main>
      </div>
    )
  }

  const day = days.find(d => d.id === (view.mode === 'plan' ? view.dayId : view.dayId))

  if (!day) {
    return <div className="app"><p>Day not found.</p><button onClick={() => setView({ mode: 'home' })}>Home</button></div>
  }

  if (view.mode === 'plan') {
    return (
      <div className="app">
        <header className="app-header">
          <button className="btn-ghost btn-sm" onClick={() => setView({ mode: 'home' })}>← Days</button>
          <h1>TecPlan</h1>
          <span className="header-sub">{day.title || day.date}{day.title ? ` · ${day.date}` : ''}</span>
          <div className="mode-tabs">
            <span className="mode-tab active">Plan</span>
          </div>
        </header>
        <main>
          <PlanMode
            day={day}
            onChange={updateDay}
            onStartChecklist={i => setView({ mode: 'checklist', dayId: day.id, diveIndex: i })}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <button className="btn-ghost btn-sm" onClick={() => setView({ mode: 'plan', dayId: day.id })}>← Plan</button>
        <h1>TecPlan</h1>
        <span className="header-sub">{day.date}</span>
      </header>
      <main>
        <ChecklistMode
          day={day}
          diveIndex={view.diveIndex}
          onBack={() => setView({ mode: 'plan', dayId: day.id })}
          onChange={updateDay}
        />
      </main>
    </div>
  )
}
