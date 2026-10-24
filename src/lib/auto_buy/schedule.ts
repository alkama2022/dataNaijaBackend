/**
 * Core Auto-Buy schedule maths.
 *
 * A schedule is fully described by:
 *   - `unit` + `interval`  → how far apart the purchases are
 *   - `daysOfWeek`         → which weekdays a weekly rule runs on
 *   - `timeOfDay`          → the wall-clock time of the purchase
 *   - `anchorAt`           → the *phase* of the schedule (its first slot)
 *   - `timezone`           → the zone the wall-clock time is expressed in
 *
 * Every later slot is derived from `anchorAt`, which keeps the schedule
 * stable even if the server was down for a while: the phase never drifts.
 */

import {
  DEFAULT_TIMEZONE,
  addDays,
  daysInMonth,
  floatingDate,
  formatDateString,
  fromFloating,
  isoWeekday,
  parseDateString,
  parseTimeOfDay,
  startOfWeek,
  toFloating,
  withTimeOfDay,
} from '@/lib/time'
import { WEEKDAY_LABELS } from '@/lib/time'
import type { FrequencyUnit } from './frequency'

export interface ScheduleSpec {
  frequency: string
  interval: number
  unit: FrequencyUnit
  /** ISO weekdays (1 = Monday … 7 = Sunday). Only used for week based rules. */
  daysOfWeek: number[]
  /** `'HH:mm'` wall-clock time inside `timezone`. */
  timeOfDay: string
  timezone: string
  /** UTC instant of the schedule's first slot. Defines the phase. */
  anchorAt: Date
}

/** Sorts, de-duplicates and clamps the weekday list to 1-7. */
export function normalizeDaysOfWeek(days: number[] | undefined | null): number[] {
  if (!days || days.length === 0) return []
  const unique = new Set<number>()
  for (const day of days) {
    if (Number.isInteger(day) && day >= 1 && day <= 7) unique.add(day)
  }
  return Array.from(unique).sort((a, b) => a - b)
}

/**
 * Resolves the anchor (phase) of a schedule.
 *
 * `startDate` is a `'YYYY-MM-DD'` calendar date expressed in the schedule's
 * own time zone — the server never trusts a client supplied UTC instant for
 * this, because the customer's intent is a wall-clock date.
 */
export function resolveAnchor(input: {
  from: Date
  timezone?: string
  unit: FrequencyUnit
  interval: number
  daysOfWeek?: number[]
  timeOfDay?: string
  startDate?: string | null
}): Date {
  const timezone = input.timezone || DEFAULT_TIMEZONE
  const time = parseTimeOfDay(input.timeOfDay || '08:00') || {
    hour: 8,
    minute: 0,
  }

  const fromLocal = toFloating(input.from, timezone)

  // 1. Base calendar date.
  let base = floatingDate(
    fromLocal.getUTCFullYear(),
    fromLocal.getUTCMonth() + 1,
    fromLocal.getUTCDate()
  )

  const parsedStart = input.startDate ? parseDateString(input.startDate) : null
  if (parsedStart) {
    base = floatingDate(parsedStart.year, parsedStart.month, parsedStart.day)
  }

  // 2. Weekly rules anchor on the first selected weekday on/after the base
  //    date, so the "every N weeks" parity is well defined.
  if (input.unit === 'weeks') {
    const days = normalizeDaysOfWeek(input.daysOfWeek)
    if (days.length > 0) {
      for (let offset = 0; offset <= 7; offset++) {
        const candidate = addDays(base, offset)
        if (days.includes(isoWeekday(candidate))) {
          base = candidate
          break
        }
      }
    }
  }

  return fromFloating(withTimeOfDay(base, time.hour, time.minute), timezone)
}

/**
 * Returns the first slot of [spec] that is strictly after [from].
 *
 * The result is a UTC instant. For hour based rules the maths is done on
 * absolute time; for day, week and month rules it is done on the wall
 * clock so "08:00" always means "08:00 in the customer's zone".
 */
export function computeNextRun(spec: ScheduleSpec, from: Date): Date {
  switch (spec.unit) {
    case 'hours':
      return nextHourSlot(spec, from)
    case 'days':
      return nextDaySlot(spec, from)
    case 'weeks':
      return nextWeekSlot(spec, from)
    case 'months':
      return nextMonthSlot(spec, from)
    default:
      return nextDaySlot(spec, from)
  }
}

/** Hour based rules advance in absolute time from the anchor. */
function nextHourSlot(spec: ScheduleSpec, from: Date): Date {
  const step = Math.max(1, spec.interval) * 3_600_000
  const anchorMs = spec.anchorAt.getTime()
  const fromMs = from.getTime()

  if (anchorMs > fromMs) return new Date(anchorMs)

  const elapsed = fromMs - anchorMs
  const periods = Math.floor(elapsed / step) + 1
  return new Date(anchorMs + periods * step)
}

/** Day based rules keep the anchor's wall-clock time. */
function nextDaySlot(spec: ScheduleSpec, from: Date): Date {
  const timezone = spec.timezone || DEFAULT_TIMEZONE
  const anchor = toFloating(spec.anchorAt, timezone)
  const fromLocal = toFloating(from, timezone)

  const step = Math.max(1, spec.interval)
  const anchorDay = Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth(),
    anchor.getUTCDate()
  )
  const fromDay = Date.UTC(
    fromLocal.getUTCFullYear(),
    fromLocal.getUTCMonth(),
    fromLocal.getUTCDate()
  )
  const daysApart = Math.round((fromDay - anchorDay) / 86_400_000)

  let periods = Math.max(0, Math.floor(daysApart / step))
  for (let guard = 0; guard < 400; guard++) {
    const candidate = addDays(anchor, periods * step)
    if (candidate.getTime() > fromLocal.getTime()) {
      return fromFloating(candidate, timezone)
    }
    periods++
  }
  return fromFloating(addDays(anchor, periods * step), timezone)
}

/**
 * Week based rules run on the selected weekdays of every N-th week,
 * counting from the anchor's week.
 */
function nextWeekSlot(spec: ScheduleSpec, from: Date): Date {
  const timezone = spec.timezone || DEFAULT_TIMEZONE
  const anchor = toFloating(spec.anchorAt, timezone)
  const fromLocal = toFloating(from, timezone)

  const time = parseTimeOfDay(spec.timeOfDay) || { hour: 8, minute: 0 }
  const days = normalizeDaysOfWeek(spec.daysOfWeek)
  // Without an explicit weekday selection the rule simply repeats on the
  // anchor's own weekday.
  const weekdays = days.length > 0 ? days : [isoWeekday(anchor)]

  const anchorWeekStart = startOfWeek(anchor)
  const step = Math.max(1, spec.interval)

  // 104 weeks ≈ two years of look-ahead; more than enough for any schedule.
  for (let week = 0; week < 104; week++) {
    const weekStart = addDays(anchorWeekStart, week * step * 7)
    for (const weekday of weekdays) {
      const candidate = withTimeOfDay(
        addDays(weekStart, weekday - 1),
        time.hour,
        time.minute
      )
      // Slots before the anchor are not part of this schedule.
      if (candidate.getTime() < anchor.getTime()) continue
      if (candidate.getTime() > fromLocal.getTime()) {
        return fromFloating(candidate, timezone)
      }
    }
  }
  return fromFloating(addDays(anchorWeekStart, 7), timezone)
}

/** Month based rules repeat on the anchor's day-of-month. */
function nextMonthSlot(spec: ScheduleSpec, from: Date): Date {
  const timezone = spec.timezone || DEFAULT_TIMEZONE
  const anchor = toFloating(spec.anchorAt, timezone)
  const fromLocal = toFloating(from, timezone)

  const time = parseTimeOfDay(spec.timeOfDay) || { hour: 8, minute: 0 }
  const anchorYear = anchor.getUTCFullYear()
  const anchorMonth = anchor.getUTCMonth()
  const anchorDay = anchor.getUTCDate()
  const step = Math.max(1, spec.interval)

  const monthsBetween =
    (fromLocal.getUTCFullYear() - anchorYear) * 12 +
    (fromLocal.getUTCMonth() - anchorMonth)

  let periods = Math.max(0, Math.floor(monthsBetween / step))
  for (let guard = 0; guard < 600; guard++) {
    const total = anchorMonth + periods * step
    const year = anchorYear + Math.floor(total / 12)
    const month = ((total % 12) + 12) % 12
    // "The 31st" becomes "the last day" in shorter months.
    const day = Math.min(anchorDay, daysInMonth(year, month + 1))
    const candidate = withTimeOfDay(
      floatingDate(year, month + 1, day),
      time.hour,
      time.minute
    )
    if (candidate.getTime() > fromLocal.getTime()) {
      return fromFloating(candidate, timezone)
    }
    periods++
  }
  return fromFloating(anchor, timezone)
}

/**
 * Builds a short, human readable summary of a schedule.
 * Used in the app and in the API responses.
 */
export function describeSchedule(spec: ScheduleSpec): string {
  const time = parseTimeOfDay(spec.timeOfDay)
  const timeLabel = time ? formatClock(time.hour, time.minute) : spec.timeOfDay
  const interval = Math.max(1, spec.interval)

  switch (spec.unit) {
    case 'hours':
      return `Every ${interval} hour${interval === 1 ? '' : 's'}${
        time ? ` from ${timeLabel}` : ''
      }`
    case 'days':
      return interval === 1
        ? `Every day at ${timeLabel}`
        : `Every ${interval} days at ${timeLabel}`
    case 'weeks': {
      const days = normalizeDaysOfWeek(spec.daysOfWeek)
      const dayLabel =
        days.length > 0
          ? days.map((d) => WEEKDAY_LABELS[d - 1]).join(', ')
          : 'the same weekday'
      return interval === 1
        ? `${dayLabel} at ${timeLabel}`
        : `Every ${interval} weeks on ${dayLabel} at ${timeLabel}`
    }
    case 'months': {
      const anchor = toFloating(spec.anchorAt, spec.timezone || DEFAULT_TIMEZONE)
      const day = anchor.getUTCDate()
      return interval === 1
        ? `Every month on the ${ordinal(day)} at ${timeLabel}`
        : `Every ${interval} months on the ${ordinal(day)} at ${timeLabel}`
    }
    default:
      return `Every ${interval} days at ${timeLabel}`
  }
}

/** Formats an hour/minute pair as a 12-hour clock label. */
export function formatClock(hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

/** "1st", "2nd", "3rd", "4th" … */
export function ordinal(value: number): string {
  const rem100 = value % 100
  if (rem100 >= 11 && rem100 <= 13) return `${value}th`
  switch (value % 10) {
    case 1:
      return `${value}st`
    case 2:
      return `${value}nd`
    case 3:
      return `${value}rd`
    default:
      return `${value}th`
  }
}

/** The calendar date (in the schedule's zone) that a slot falls on. */
export function slotDateLabel(instant: Date, timezone: string): string {
  return formatDateString(toFloating(instant, timezone))
}
