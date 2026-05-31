import type { BadgeStatus } from '../types'

const styles: Record<BadgeStatus, string> = {
  ok:    'badge-ok',
  low:   'badge-low',
  short: 'badge-short',
}

const labels: Record<BadgeStatus, string> = {
  ok:    'OK',
  low:   'LOW',
  short: 'SHORT',
}

export function Badge({ status }: { status: BadgeStatus }) {
  return <span className={`badge ${styles[status]}`}>{labels[status]}</span>
}
