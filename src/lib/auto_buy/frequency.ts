/**
 * Auto-Buy frequency catalogue.
 *
 * A frequency describes *how often* a bundle is bought. It is deliberately
 * data-driven so the Flutter app and the API always agree on the exact set
 * of options that a customer can pick from.
 */

/** The unit a schedule interval is measured in. */
export type FrequencyUnit = 'hours' | 'days' | 'weeks' | 'months'

export interface FrequencyOption {
  /** Stable key stored on the schedule row. */
  key: string
  /** Human readable label shown in the app. */
  label: string
  /** Interval unit. */
  unit: FrequencyUnit
  /** How many units between purchases. */
  interval: number
  /** Weekly-style rules let the customer pick the weekdays. */
  supportsDaysOfWeek: boolean
  /** Rules measured in days or longer run at a wall-clock time of day. */
  supportsTimeOfDay: boolean
}

/**
 * The supported frequencies, in the order they are shown in the app.
 *
 * `custom` is a placeholder — the customer supplies their own interval and
 * unit, which the API validates separately.
 */
export const AUTO_BUY_FREQUENCIES: FrequencyOption[] = [
  {
    key: 'every_2_hours',
    label: 'Every 2 hours',
    unit: 'hours',
    interval: 2,
    supportsDaysOfWeek: false,
    supportsTimeOfDay: true,
  },
  {
    key: 'every_4_hours',
    label: 'Every 4 hours',
    unit: 'hours',
    interval: 4,
    supportsDaysOfWeek: false,
    supportsTimeOfDay: true,
  },
  {
    key: 'every_6_hours',
    label: 'Every 6 hours',
    unit: 'hours',
    interval: 6,
    supportsDaysOfWeek: false,
    supportsTimeOfDay: true,
  },
  {
    key: 'every_12_hours',
    label: 'Every 12 hours',
    unit: 'hours',
    interval: 12,
    supportsDaysOfWeek: false,
    supportsTimeOfDay: true,
  },
  {
    key: 'daily',
    label: 'Every day',
    unit: 'days',
    interval: 1,
    supportsDaysOfWeek: false,
    supportsTimeOfDay: true,
  },
  {
    key: 'every_2_days',
    label: 'Every 2 days',
    unit: 'days',
    interval: 2,
    supportsDaysOfWeek: false,
    supportsTimeOfDay: true,
  },
  {
    key: 'every_3_days',
    label: 'Every 3 days',
    unit: 'days',
    interval: 3,
    supportsDaysOfWeek: false,
    supportsTimeOfDay: true,
  },
  {
    key: 'weekly',
    label: 'Every week',
    unit: 'weeks',
    interval: 1,
    supportsDaysOfWeek: true,
    supportsTimeOfDay: true,
  },
  {
    key: 'every_2_weeks',
    label: 'Every 2 weeks',
    unit: 'weeks',
    interval: 2,
    supportsDaysOfWeek: true,
    supportsTimeOfDay: true,
  },
  {
    key: 'monthly',
    label: 'Every month',
    unit: 'months',
    interval: 1,
    supportsDaysOfWeek: false,
    supportsTimeOfDay: true,
  },
  {
    key: 'custom',
    label: 'Custom schedule',
    unit: 'days',
    interval: 1,
    supportsDaysOfWeek: true,
    supportsTimeOfDay: true,
  },
]

/** Minimum and maximum interval a custom schedule may use. */
export const CUSTOM_INTERVAL_MIN = 1
export const CUSTOM_INTERVAL_MAX = 365

export const FREQUENCY_UNITS: FrequencyUnit[] = [
  'hours',
  'days',
  'weeks',
  'months',
]

/** Looks up a frequency option by key. */
export function findFrequency(key: string): FrequencyOption | undefined {
  return AUTO_BUY_FREQUENCIES.find((f) => f.key === key)
}

/** Type guard for the interval unit. */
export function isFrequencyUnit(value: string): value is FrequencyUnit {
  return (FREQUENCY_UNITS as string[]).includes(value)
}

/**
 * Resolves the effective interval/unit for a frequency key.
 *
 * For every key except `custom` the catalogue is authoritative. For
 * `custom` the customer supplies both the interval and the unit.
 */
export function resolveInterval(
  frequency: string,
  customInterval?: number,
  customUnit?: FrequencyUnit
): { interval: number; unit: FrequencyUnit } {
  if (frequency === 'custom') {
    return {
      interval: customInterval ?? 1,
      unit: customUnit ?? 'days',
    }
  }
  const option = findFrequency(frequency)
  if (!option) {
    throw new Error(`Unknown auto-buy frequency: ${frequency}`)
  }
  return { interval: option.interval, unit: option.unit }
}
