/**
 * Shapes an Auto-Buy rule / execution for the API.
 *
 * The JSON contract is shared with the Flutter app, so the field names here
 * are the single source of truth for the mobile client.
 */

import { describeSchedule, formatClock, type ScheduleSpec } from './schedule'
import { isoWeekday, toFloating } from '@/lib/time'
import { DEFAULT_TIMEZONE, WEEKDAY_LABELS } from '@/lib/time'

/** Structural view of an `AutoBuySchedule` row. */
export interface ScheduleRow {
  id: string
  userId: string
  network: string
  planType: string
  planGb: string
  planDays: string
  planId: string | null
  price: number
  phone: string
  frequency: string
  interval: number
  unit: string
  daysOfWeek: number[]
  timeOfDay: string
  timezone: string
  status: string
  anchorAt: Date
  nextRunAt: Date
  pendingSlot: Date | null
  lastRunAt: Date | null
  consecutiveFailures: number
  maxRetries: number
  consentAt: Date
  createdAt: Date
  updatedAt: Date
}

/** Structural view of an `AutoBuyExecution` row. */
export interface ExecutionRow {
  id: string
  scheduleId: string
  userId: string
  scheduledFor: Date
  status: string
  amount: number
  ref: string | null
  error: string | null
  attempt: number
  createdAt: Date
  updatedAt: Date
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** Builds the schedule spec used by the maths helpers. */
export function toSpec(schedule: ScheduleRow): ScheduleSpec {
  return {
    frequency: schedule.frequency,
    interval: schedule.interval,
    unit: schedule.unit as ScheduleSpec['unit'],
    daysOfWeek: schedule.daysOfWeek ?? [],
    timeOfDay: schedule.timeOfDay,
    timezone: schedule.timezone || DEFAULT_TIMEZONE,
    anchorAt: schedule.anchorAt,
  }
}

/**
 * Formats an instant as a local, human friendly label, e.g.
 * "Tue, 20 Oct 2026 · 08:00 AM WAT".
 */
export function formatSlotLabel(instant: Date, timezone: string): string {
  const zone = timezone || DEFAULT_TIMEZONE
  const local = toFloating(instant, zone)
  const weekday = WEEKDAY_LABELS[isoWeekday(local) - 1]
  const day = local.getUTCDate()
  const month = MONTH_LABELS[local.getUTCMonth()]
  const year = local.getUTCFullYear()
  const clock = formatClock(local.getUTCHours(), local.getUTCMinutes())
  return `${weekday}, ${day} ${month} ${year} · ${clock} WAT`
}

/** Serialises a schedule for the API. */
export function presentSchedule(schedule: ScheduleRow) {
  const spec = toSpec(schedule)
  return {
    id: schedule.id,
    userId: schedule.userId,
    network: schedule.network,
    planType: schedule.planType,
    planGb: schedule.planGb,
    planDays: schedule.planDays,
    planId: schedule.planId,
    price: schedule.price,
    phone: schedule.phone,
    frequency: schedule.frequency,
    interval: schedule.interval,
    unit: schedule.unit,
    daysOfWeek: schedule.daysOfWeek ?? [],
    timeOfDay: schedule.timeOfDay,
    timezone: schedule.timezone || DEFAULT_TIMEZONE,
    status: schedule.status,
    anchorAt: schedule.anchorAt.toISOString(),
    nextRunAt: schedule.nextRunAt.toISOString(),
    pendingSlot: schedule.pendingSlot?.toISOString() ?? null,
    lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
    consecutiveFailures: schedule.consecutiveFailures,
    maxRetries: schedule.maxRetries,
    consentAt: schedule.consentAt.toISOString(),
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
    summary: describeSchedule(spec),
    nextRunLabel: formatSlotLabel(schedule.nextRunAt, schedule.timezone),
    lastRunLabel: schedule.lastRunAt
      ? formatSlotLabel(schedule.lastRunAt, schedule.timezone)
      : null,
  }
}

/** Serialises an execution for the API. */
export function presentExecution(execution: ExecutionRow) {
  return {
    id: execution.id,
    scheduleId: execution.scheduleId,
    scheduledFor: execution.scheduledFor.toISOString(),
    status: execution.status,
    amount: execution.amount,
    ref: execution.ref,
    error: execution.error,
    attempt: execution.attempt,
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
  }
}
