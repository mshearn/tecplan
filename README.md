# TecPlan

Technical dive planning and pre-dive verification for OC technical divers. Built for use at the dock before getting in the water.

## What it does

TecPlan walks through the paper flow that tec divers already do manually — equipment setup, gas verification, and buddy sign-off — and replaces the paper checklist with a digital one that does the math for you.

**Plan screen** — build a dive day: cylinders (back gas + stages), dive sequence with gas phases and required volumes per phase. Gas drawdown is simulated across the full sequence so you can confirm feasibility before leaving the dock.

**Checklist screen** (3 steps):
1. **Deco Plan** — review the planned profile: depth, bottom time, runtime, gas phases from your deco software
2. **Equipment** — enter current gauge PSI for each cylinder; the app calculates available volume and flags SHORT/LOW/OK
3. **Verify** — auto-generated buddy check (regulator function, isolator valve, SPG readings, gas switch depths, turn pressure, gradient factors); both divers check each item, then sign off

**Post-dive** — record actual post-dive PSI; stage pressures carry forward automatically to the next dive's calculations.

## Gas volume import from Subsurface

TecPlan can import planned dives directly from [Subsurface](https://subsurface-divelog.org/) dive planning software:

1. Plan your dive in Subsurface's dive planner
2. Export: **File → Export → Subsurface XML** (saves as `.ssrm` or `.xml`)
3. In TecPlan: open a dive day → Dive Sequence → **↓ Import from Subsurface**
4. Pick the exported file

TecPlan reads the plan waypoints and computes required volume per gas using your plan's SAC rates (bottom + deco) and average depth per segment. Cylinders are matched to the day's equipment by gas mix (Air, EAN50, O2, TMX). Unmatched gases are added to Equipment automatically.

Both `.ssrm` (ZIP archive) and `.xml` (plain) formats are supported.

## Gas math

```
available_ft3 = rated_volume × count × (current_psi / rated_pressure)
margin = available_ft3 - required_ft3
```

Badge thresholds:
- **OK** — margin ≥ 20%
- **LOW** — margin 0–20%
- **SHORT** — margin < 0% (sign-off blocked unless override + written reason)

## Local dev

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build
```

No backend. No auth. All data lives in `localStorage`. Works offline after the first asset load — PWA upgrade planned.

## Stack

- React + Vite + TypeScript
- All state in `localStorage` via `src/lib/storage.ts`
- Gas physics in `src/lib/gas.ts`
- Multi-dive simulation in `src/lib/simulation.ts`
- Subsurface XML parsing in `src/lib/subsurface.ts` (fflate for .ssrm ZIP extraction)
- Zero external UI dependencies

## Data model

All data is user-created — no seed data. A **DiveDay** contains:
- `cylinders[]` — rated volume (ft³), rated pressure (PSI), mix, count, type (back gas / stage)
- `dives[]` — bottom depth, bottom time, total runtime, turn pressure, `gasPhases[]`
- `postDivePressures` — actual readings after each dive, carried forward to the next
- `signOffs` — diver names, timestamp, optional override reason

## Units

Imperial throughout: ft, ft³, PSI, min.
