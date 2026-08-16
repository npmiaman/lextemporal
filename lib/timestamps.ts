/**
 * SQLite writes `updated_at` / `created_at` as UTC with no zone marker
 * ("2026-08-16 11:20:55.366"). `Date.parse` treats that as LOCAL time, so every
 * age comes out shifted by the viewer's offset - 5h30m of error in IST, enough
 * to label a running agent as hours old. Mark it as UTC before parsing.
 *
 * Returns NaN for values it cannot read, so callers decide the fallback rather
 * than rendering "NaN" or a wrong date.
 */
export function parseDbTimestamp(value: string): number {
  if (!value) return NaN
  const trimmed = value.trim()
  // Already ISO with a zone (…Z or ±HH:MM): trust it as-is.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) return Date.parse(trimmed)
  return Date.parse(`${trimmed.replace(' ', 'T')}Z`)
}

/** Compact age for list rows: now, 5m, 3h, 12d, 4mo, 2y. */
export function relativeAge(value: string, now = Date.now()): string {
  const at = parseDbTimestamp(value)
  if (!Number.isFinite(at)) return ''
  const minutes = Math.round((now - at) / 60_000)
  // A clock skew between writer and reader must never read as the future.
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.round(days / 30)
  return months < 12 ? `${months}mo` : `${Math.round(months / 12)}y`
}
