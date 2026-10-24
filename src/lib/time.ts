/**
 * Time-zone helpers for Auto-Buy schedules.
 *
 * Nigerian customers run on `Africa/Lagos` (WAT, UTC+1, no daylight saving)
 * but the code below is written against the IANA database so the schedule
 * stays correct if the customer is ever in a different zone.
 *
 * The trick used throughout is the "floating date": a `Date` whose *UTC*
 * fields hold the wall-clock time in the target zone. Wall-clock maths
 * (adding a day, jumping to the next Monday) is then plain `Date` maths
 * with no offset surprises, and the floating date is converted back to a
 * real UTC instant only at the very end.
 */

export const DEFAULT_TIMEZONE = 'Africa/Lagos'

/** Short weekday labels, Monday first. */
export const WEEKDAY_LABELS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const

export interface ZonedParts {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number // 0-23
  minute: number
  second: number
}

const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

/** Splits an instant into its wall-clock parts inside [timeZone]. */
export function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    // Unknown zone — fall back to UTC rather than crashing the scheduler.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const parts = formatter.formatToParts(instant)
  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // `h23` can still yield "24" in some ICU builds — normalise to 0-23.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

/**
 * Offset of [timeZone] from UTC at [instant], in milliseconds.
 * Positive means the zone is ahead of UTC (Lagos is +3_600_000).
 */
export function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = getZonedParts(instant, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  // Drop sub-second precision on both sides so the maths is exact.
  const floored = Math.floor(instant.getTime() / 1000) * 1000
  return asUtc - floored
}

/**
 * Converts a UTC instant into a floating date whose UTC fields hold the
 * local wall-clock time of [timeZone].
 */
export function toFloating(instant: Date, timeZone: string): Date {
  const p = getZonedParts(instant, timeZone)
  return new Date(
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  )
}

/**
 * Converts a floating date (local wall-clock) back into a UTC instant.
 *
 * The offset is applied twice because the first correction can land on the
 * other side of a daylight-saving transition.
 */
export function fromFloating(floating: Date, timeZone: string): Date {
  const year = floating.getUTCFullYear()
  const month = floating.getUTCMonth() + 1
  const day = floating.getUTCDate()
  const hour = floating.getUTCHours()
  const minute = floating.getUTCMinutes()
  const second = floating.getUTCSeconds()

  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const firstOffset = getTimeZoneOffsetMs(new Date(guess), timeZone)
  let instant = new Date(guess - firstOffset)

  const secondOffset = getTimeZoneOffsetMs(instant, timeZone)
  if (secondOffset !== firstOffset) {
    instant = new Date(guess - secondOffset)
  }
  return instant
}

/** Builds a floating date from calendar parts. */
export function floatingDate(
  year: number,
  month: number, // 1-12
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second))
}

/** Adds whole days to a floating date, keeping the wall-clock time. */
export function addDays(floating: Date, days: number): Date {
  return new Date(floating.getTime() + days * MS_PER_DAY)
}

/** Replaces the time-of-day of a floating date. */
export function withTimeOfDay(
  floating: Date,
  hour: number,
  minute: number
): Date {
  return new Date(
    Date.UTC(
      floating.getUTCFullYear(),
      floating.getUTCMonth(),
      floating.getUTCDate(),
      hour,
      minute,
      0
    )
  )
}

/** ISO weekday of a floating date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(floating: Date): number {
  const day = floating.getUTCDay() // 0 = Sunday
  return day === 0 ? 7 : day
}

/** Monday 00:00 of the week the given floating date belongs to. */
export function startOfWeek(floating: Date): Date {
  return addDays(floating, -(isoWeekday(floating) - 1))
}

/** Number of days in a given (1-12) month of a year. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Parses a `'HH:mm'` string. Returns null when the value is malformed. */
export function parseTimeOfDay(value: string): {
  hour: number
  minute: number
} | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

/** Formats an hour/minute pair as `'HH:mm'`. */
export function formatTimeOfDay(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Parses a `'YYYY-MM-DD'` string into calendar parts. */
export function parseDateString(
  value: string
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null
  }
  return { year, month, day }
}

/** Formats a floating date as `'YYYY-MM-DD'`. */
export function formatDateString(floating: Date): string {
  return `${floating.getUTCFullYear()}-${String(
    floating.getUTCMonth() + 1
  ).padStart(2, '0')}-${String(floating.getUTCDate()).padStart(2, '0')}`
}

/** The wall-clock time of an instant inside a zone, as `'HH:mm'`. */
export function timeOfDayInZone(instant: Date, timeZone: string): string {
  const p = getZonedParts(instant, timeZone)
  return formatTimeOfDay(p.hour, p.minute)
}

export { MS_PER_MINUTE, MS_PER_HOUR, MS_PER_DAY }
