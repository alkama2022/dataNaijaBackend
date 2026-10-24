import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { autoBuyCreateSchema } from '@/lib/validators'
import { resolveInterval } from '@/lib/auto_buy/frequency'
import {
  computeNextRun,
  normalizeDaysOfWeek,
  resolveAnchor,
} from '@/lib/auto_buy/schedule'
import { resolveBundleFromCatalogue } from '@/lib/auto_buy/provider'
import { presentSchedule } from '@/lib/auto_buy/presenter'
import { DEFAULT_TIMEZONE } from '@/lib/time'

/**
 * Auto-Buy schedules.
 *
 * GET  — list the signed-in customer's rules.
 * POST — create a rule (explicit consent required).
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let payload
    try {
      payload = await verifyToken(authHeader.slice(7))
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const userId = (payload as { userId: string }).userId

    const schedules = await prisma.autoBuySchedule.findMany({
      // A customer only ever sees their own rules.
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(schedules.map(presentSchedule))
  } catch (error) {
    console.error('Auto-Buy list error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let payload
    try {
      payload = await verifyToken(authHeader.slice(7))
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const userId = (payload as { userId: string }).userId

    const body = await request.json()
    const parsed = autoBuyCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const input = parsed.data

    // Resolve the interval/unit. For `custom` the customer supplies them.
    let interval: number
    let unit: 'hours' | 'days' | 'weeks' | 'months'
    try {
      const resolved = resolveInterval(input.frequency, input.interval, input.unit)
      interval = resolved.interval
      unit = resolved.unit
    } catch {
      return NextResponse.json({ error: 'Unknown frequency' }, { status: 400 })
    }

    const daysOfWeek = normalizeDaysOfWeek(input.daysOfWeek)
    if (unit === 'weeks' && daysOfWeek.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one day of the week' },
        { status: 400 }
      )
    }

    const timezone = input.timezone || DEFAULT_TIMEZONE
    const now = new Date()

    // Re-check the bundle against the catalogue. The price stored on the rule
    // is always the server's price, never the one the client displayed.
    const bundle = await resolveBundleFromCatalogue({
      network: input.network,
      planType: input.planType,
      planGb: input.planGb,
      planDays: input.planDays,
      planId: input.planId ?? null,
    })

    if (!bundle.available) {
      return NextResponse.json(
        { error: bundle.reason ?? 'This bundle is not available' },
        { status: 400 }
      )
    }

    const anchorAt = resolveAnchor({
      from: now,
      timezone,
      unit,
      interval,
      daysOfWeek,
      timeOfDay: input.timeOfDay,
      startDate: input.startDate ?? null,
    })

    const spec = {
      frequency: input.frequency,
      interval,
      unit,
      daysOfWeek,
      timeOfDay: input.timeOfDay,
      timezone,
      anchorAt,
    }

    // The first purchase always happens in the future.
    const nextRunAt = computeNextRun(spec, now)

    const schedule = await prisma.autoBuySchedule.create({
      data: {
        userId,
        network: input.network,
        planType: input.planType,
        planGb: input.planGb,
        planDays: input.planDays,
        planId: bundle.planId,
        price: bundle.price,
        phone: input.phone,
        frequency: input.frequency,
        interval,
        unit,
        daysOfWeek,
        timeOfDay: input.timeOfDay,
        timezone,
        status: 'Active',
        anchorAt,
        nextRunAt,
        consentAt: now,
        createdAt: now,
        updatedAt: now,
      },
    })

    return NextResponse.json({
      success: true,
      schedule: presentSchedule(schedule),
    })
  } catch (error) {
    console.error('Auto-Buy create error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
