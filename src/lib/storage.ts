import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate'
import type { DiveDay, Cylinder } from '../types'

const KEY = 'tecplan_days'

// Migrate a day object from any older schema version to the current one.
function migrate(raw: Record<string, unknown>): DiveDay {
  const cylinders = ((raw.cylinders as Array<Record<string, unknown>>) ?? []).map(
    (c): Cylinder => ({
      id: c.id as string,
      label: (c.label as string) ?? '',
      type: (c.type as 'back_gas' | 'stage') ?? 'back_gas',
      mix: (c.mix as string) ?? 'Air',
      ratedVolume: (c.ratedVolume as number) ?? 80,
      ratedPressure: (c.ratedPressure as number) ?? 3000,
      count: (c.count as number) ?? 1,
      refillBetweenDives: c.refillBetweenDives !== undefined
        ? Boolean(c.refillBetweenDives)
        : c.type === 'back_gas',
    })
  )
  return {
    id: raw.id as string,
    title: (raw.title as string) ?? '',
    date: (raw.date as string) ?? new Date().toISOString().slice(0, 10),
    diver1: (raw.diver1 as string) ?? '',
    diver2: (raw.diver2 as string) ?? '',
    cylinders,
    dives: (raw.dives as DiveDay['dives']) ?? [],
    postDivePressures: (raw.postDivePressures as DiveDay['postDivePressures']) ?? {},
    signOffs: (raw.signOffs as DiveDay['signOffs']) ?? [],
  }
}

export function loadDays(): DiveDay[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
    return parsed.map(migrate)
  } catch {
    return []
  }
}

export function saveDays(days: DiveDay[]): void {
  localStorage.setItem(KEY, JSON.stringify(days))
}

export function upsertDay(day: DiveDay): void {
  const days = loadDays()
  const idx = days.findIndex(d => d.id === day.id)
  if (idx >= 0) days[idx] = day
  else days.push(day)
  saveDays(days)
}

export function deleteDay(id: string): void {
  saveDays(loadDays().filter(d => d.id !== id))
}

export function uid(): string {
  return crypto.randomUUID()
}

export function exportDay(day: DiveDay): void {
  const payload = JSON.stringify({ version: 1, exported: new Date().toISOString(), day }, null, 2)
  const blob = new Blob([payload], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const slug = (day.title || 'dive-day').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  a.download = `tecplan-${slug}-${day.date}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// Compress a dive day to a base64url string small enough for a QR code URL.
export function encodeDayForUrl(day: DiveDay): string {
  const json = JSON.stringify(day)
  const compressed = deflateSync(strToU8(json))
  return btoa(String.fromCharCode(...compressed))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeDayFromUrl(encoded: string): DiveDay {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const raw = JSON.parse(strFromU8(inflateSync(bytes))) as Record<string, unknown>
  if (!raw.id || !Array.isArray(raw.dives)) throw new Error('Invalid QR data')
  return migrate(raw)
}

export async function importDayFromFile(file: File): Promise<DiveDay> {
  const text = await file.text()
  const parsed = JSON.parse(text) as Record<string, unknown>
  // Accept both the wrapped format { version, day } and a bare DiveDay object
  const raw = (parsed.day ?? parsed) as Record<string, unknown>
  if (!raw.id || !Array.isArray(raw.dives)) {
    throw new Error('Not a valid TecPlan export file')
  }
  return migrate(raw)
}
