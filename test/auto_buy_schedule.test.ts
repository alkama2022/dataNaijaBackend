// Unit tests for the Auto-Buy schedule maths.
//
// These are pure functions — no database, no network. They pin down the
// behaviour every supported frequency must have, including the Nigerian
// time zone (Africa/Lagos = UTC+1, no daylight saving).

import {
  computeNextRun,
  describeSchedule,
  normalizeDaysOfWeek,
  resolveAnchor,
  type ScheduleSpec,
} from '@/lib/auto_buy/schedule'
import { getTimeZoneOffsetMs, toFloating } from '@/lib/time'

const LAGOS = 'Africa/Lagos'

/** Builds a UTC instant. */
function utc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute))
}

/** The wall-clock parts of an instant inside Lagos. */
function localParts(instant: Date) {
  const floating = toFloating(instant, LAGOS)
  return {
    year: floating.getUTCFullYear(),
    month: floating.getUTCMonth() + 1,
    day: floating.getUTCDate(),
    hour: floating.getUTCHours(),
    minute: floating.getUTCMinutes(),
    weekday: floating.getUTCDay() === 0 ? 7 : floating.getUTCDay(),
  }
}

function spec(overrides: Partial<ScheduleSpec> = {}): ScheduleSpec {
  return {
    frequency: 'daily',
    interval: 1,
    unit: 'days',
    daysOfWeek: [],
    timeOfDay: '08:00',
    timezone: LAGOS,
    anchorAt: utc(2026, 10, 19, 7, 0), // 08:00 in Lagos
    ...overrides,
  }
}

describe('time zone handling', () => {
  test('Africa/Lagos is UTC+1 all year', () => {
    expect(getTimeZoneOffsetMs(utc(2026, 1, 15, 12), LAGOS)).toBe(3_600_000)
    expect(getTimeZoneOffsetMs(utc(2026, 7, 15, 12), LAGOS)).toBe(3_600_000)
  })

  test('a Lagos 08:00 slot is 07:00 UTC', () => {
    const anchor = resolveAnchor({
      from: utc(2026, 10, 19, 0, 0),
      timezone: LAGOS,
      unit: 'days',
      interval: 1,
      timeOfDay: '08:00',
      startDate: '2026-10-19',
    })
    expect(anchor.toISOString()).toBe('2026-10-19T07:00:00.000Z')
    expect(localParts(anchor)).toMatchObject({
      year: 2026,
      month: 10,
      day: 19,
      hour: 8,
      minute: 0,
    })
  })
})

describe('resolveAnchor', () => {
  test('uses the requested start date and time', () => {
    const anchor = resolveAnchor({
      from: utc(2026, 10, 19, 0, 0),
      timezone: LAGOS,
      unit: 'days',
      interval: 1,
      timeOfDay: '06:30',
      startDate: '2026-10-25',
    })
    expect(localParts(anchor)).toMatchObject({
      year: 2026,
      month: 10,
      day: 25,
      hour: 6,
      minute: 30,
    })
  })

  test('weekly rules anchor on the first selected weekday', () => {
    // 2026-10-19 is a Monday; the first selected weekday is Wednesday.
    const anchor = resolveAnchor({
      from: utc(2026, 10, 19, 0, 0),
      timezone: LAGOS,
      unit: 'weeks',
      interval: 1,
      daysOfWeek: [3, 5],
      timeOfDay: '08:00',
      startDate: '2026-10-19',
    })
    expect(localParts(anchor)).toMatchObject({ day: 21, hour: 8 })
  })
})

describe('computeNextRun — every N hours', () => {
  test('every 2 hours advances in absolute time', () => {
    const next = computeNextRun(
      spec({ frequency: 'every_2_hours', unit: 'hours', interval: 2 }),
      utc(2026, 10, 19, 14, 0)
    )
    expect(localParts(next)).toMatchObject({ day: 19, hour: 16, minute: 0 })
  })

  test('every 4 hours', () => {
    const next = computeNextRun(
      spec({ frequency: 'every_4_hours', unit: 'hours', interval: 4 }),
      utc(2026, 10, 19, 9, 0)
    )
    expect(localParts(next)).toMatchObject({ day: 19, hour: 12, minute: 0 })
  })

  test('every 6 hours', () => {
    const next = computeNextRun(
      spec({ frequency: 'every_6_hours', unit: 'hours', interval: 6 }),
      utc(2026, 10, 19, 9, 0)
    )
    expect(localParts(next)).toMatchObject({ day: 19, hour: 14, minute: 0 })
  })

  test('every 12 hours rolls over to the next day', () => {
    // The anchor is 08:00 in Lagos, so the slots are 08:00 and 20:00.
    const next = computeNextRun(
      spec({ frequency: 'every_12_hours', unit: 'hours', interval: 12 }),
      utc(2026, 10, 19, 20, 0) // 21:00 in Lagos
    )
    expect(localParts(next)).toMatchObject({ day: 20, hour: 8, minute: 0 })
  })

  test('an hourly rule that starts in the future runs at the start time', () => {
    const next = computeNextRun(
      spec({
        frequency: 'every_2_hours',
        unit: 'hours',
        interval: 2,
        anchorAt: utc(2026, 10, 19, 17, 0), // 18:00 Lagos
      }),
      utc(2026, 10, 19, 14, 0)
    )
    expect(localParts(next)).toMatchObject({ day: 19, hour: 18, minute: 0 })
  })
})

describe('computeNextRun — day based rules', () => {
  test('every day keeps the wall-clock time', () => {
    const next = computeNextRun(spec(), utc(2026, 10, 19, 14, 0))
    expect(localParts(next)).toMatchObject({ day: 20, hour: 8, minute: 0 })
  })

  test('every day before the slot time runs the same day', () => {
    const next = computeNextRun(spec(), utc(2026, 10, 19, 6, 0))
    expect(localParts(next)).toMatchObject({ day: 19, hour: 8, minute: 0 })
  })

  test('every 2 days', () => {
    const next = computeNextRun(
      spec({ frequency: 'every_2_days', unit: 'days', interval: 2 }),
      utc(2026, 10, 19, 14, 0)
    )
    expect(localParts(next)).toMatchObject({ day: 21, hour: 8, minute: 0 })
  })

  test('every 3 days', () => {
    const next = computeNextRun(
      spec({ frequency: 'every_3_days', unit: 'days', interval: 3 }),
      utc(2026, 10, 19, 14, 0)
    )
    expect(localParts(next)).toMatchObject({ day: 22, hour: 8, minute: 0 })
  })

  test('a custom 5 day interval', () => {
    const next = computeNextRun(
      spec({ frequency: 'custom', unit: 'days', interval: 5 }),
      utc(2026, 10, 19, 14, 0)
    )
    expect(localParts(next)).toMatchObject({ day: 24, hour: 8, minute: 0 })
  })
})

describe('computeNextRun — weekly rules', () => {
  test('runs on the selected weekdays only', () => {
    // Monday, Wednesday and Friday at 08:00.
    const rule = spec({
      frequency: 'weekly',
      unit: 'weeks',
      interval: 1,
      daysOfWeek: [1, 3, 5],
    })

    // From Monday 09:00 the next slot is Wednesday.
    expect(localParts(computeNextRun(rule, utc(2026, 10, 19, 8, 0)))).toMatchObject({
      day: 21,
      hour: 8,
    })
    // From Wednesday 09:00 the next slot is Friday.
    expect(localParts(computeNextRun(rule, utc(2026, 10, 21, 8, 0)))).toMatchObject({
      day: 23,
      hour: 8,
    })
    // From Friday 09:00 the next slot is Monday.
    expect(localParts(computeNextRun(rule, utc(2026, 10, 23, 8, 0)))).toMatchObject({
      day: 26,
      hour: 8,
    })
  })

  test('every 2 weeks only fires in the anchor week and every second week', () => {
    const rule = spec({
      frequency: 'every_2_weeks',
      unit: 'weeks',
      interval: 2,
      daysOfWeek: [1],
    })

    // Anchor week: Monday 19 Oct. The Monday of the week in between is
    // skipped, the next slot is two weeks later.
    expect(localParts(computeNextRun(rule, utc(2026, 10, 19, 8, 0)))).toMatchObject({
      day: 2,
      month: 11,
      hour: 8,
    })
    // …and it keeps alternating.
    expect(localParts(computeNextRun(rule, utc(2026, 11, 2, 8, 0)))).toMatchObject({
      day: 16,
      month: 11,
      hour: 8,
    })
  })
})

describe('computeNextRun — monthly rules', () => {
  test('repeats on the same day of the month', () => {
    const next = computeNextRun(
      spec({ frequency: 'monthly', unit: 'months', interval: 1 }),
      utc(2026, 10, 19, 14, 0)
    )
    expect(localParts(next)).toMatchObject({
      year: 2026,
      month: 11,
      day: 19,
      hour: 8,
    })
  })

  test('clamps to the last day of a shorter month', () => {
    // 31 October → 30 November → 31 December → 31 January → 28 February.
    const rule = spec({
      frequency: 'monthly',
      unit: 'months',
      interval: 1,
      anchorAt: utc(2026, 10, 31, 7, 0),
    })
    expect(localParts(computeNextRun(rule, utc(2026, 10, 31, 9, 0)))).toMatchObject({
      month: 11,
      day: 30,
    })
    expect(localParts(computeNextRun(rule, utc(2026, 11, 30, 9, 0)))).toMatchObject({
      month: 12,
      day: 31,
    })
    expect(localParts(computeNextRun(rule, utc(2026, 12, 31, 9, 0)))).toMatchObject({
      year: 2027,
      month: 1,
      day: 31,
    })
    expect(localParts(computeNextRun(rule, utc(2027, 1, 31, 9, 0)))).toMatchObject({
      year: 2027,
      month: 2,
      day: 28,
    })
  })
})

describe('helpers', () => {
  test('normalises the weekday list', () => {
    expect(normalizeDaysOfWeek([5, 1, 3, 3, 9, 0])).toEqual([1, 3, 5])
    expect(normalizeDaysOfWeek([])).toEqual([])
    expect(normalizeDaysOfWeek(undefined)).toEqual([])
  })

  test('describes a schedule in plain language', () => {
    expect(
      describeSchedule(spec({ frequency: 'every_4_hours', unit: 'hours', interval: 4 }))
    ).toBe('Every 4 hours from 8:00 AM')
    expect(describeSchedule(spec())).toBe('Every day at 8:00 AM')
    expect(
      describeSchedule(
        spec({ frequency: 'every_2_days', unit: 'days', interval: 2 })
      )
    ).toBe('Every 2 days at 8:00 AM')
    expect(
      describeSchedule(
        spec({
          frequency: 'weekly',
          unit: 'weeks',
          interval: 1,
          daysOfWeek: [1, 3, 5],
        })
      )
    ).toBe('Mon, Wed, Fri at 8:00 AM')
    expect(
      describeSchedule(
        spec({
          frequency: 'every_2_weeks',
          unit: 'weeks',
          interval: 2,
          daysOfWeek: [1, 5],
        })
      )
    ).toBe('Every 2 weeks on Mon, Fri at 8:00 AM')
    expect(
      describeSchedule(spec({ frequency: 'monthly', unit: 'months', interval: 1 }))
    ).toBe('Every month on the 19th at 8:00 AM')
  })
})
