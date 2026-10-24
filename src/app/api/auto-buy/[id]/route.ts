import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { autoBuyUpdateSchema } from '@/lib/validators'
import { resolveInterval } from '@/lib/auto_buy/frequency'
import {
  computeNextRun,
  normalizeDaysOfWeek,
  resolveAnchor,
} from '@/lib/auto_buy/schedule'
import { resolveBundleFromCatalogue } from '@/lib/auto_buy/provider'
import { presentSchedule, presentExecution } from '@/lib/auto_buy/presenter'
import { DEFAULT_TIMEZONE } from '@/lib/time'

/**
 * A single Auto-Buy rule.
 *
 * GET    — the rule plus its recent executions.
 * PATCH  — edit the rule, pause it (`status: 'Paused'`) or resume it
 *          (`status: 'Active'`, which requires fresh consent).
 * DELETE — remove the rule.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    // The `userId` filter is what stops a customer reading someone else's
    // rule by guessing an id.
    const schedule = await prisma.autoBuySchedule.findFirst({
      where: { id: params.id, userId },
    })
    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const executions = await prisma.autoBuyExecution.findMany({
      where: { scheduleId: schedule.id },
      orderBy: { scheduledFor: 'desc' },
      take: 50,
    })

    return NextResponse.json({
      schedule: presentSchedule(schedule),
      executions: executions.map(presentExecution),
    })
  } catch (error) {
    console.error('Auto-Buy detail error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
    const parsed = autoBuyUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const input = parsed.data

    const existing = await prisma.autoBuySchedule.findFirst({
      where: { id: params.id, userId },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const now = new Date()

    // ── Pause / resume ──────────────────────────────────────────────
    if (input.status && input.status !== existing.status) {
      if (input.status === 'Active') {
        // Re-activating an automatic purchase needs explicit consent.
        if (existing.status === 'Paused' && input.consent !== true) {
          return NextResponse.json(
            { error: 'Consent is required to activate Auto-Buy' },
            { status: 400 }
          )
        }
        // Recompute the next slot so a resumed rule starts from now.
        const anchorAt = resolveAnchor({
          from: now,
          timezone: existing.timezone,
          unit: existing.unit as 'hours' | 'days' | 'weeks' | 'months',
          interval: existing.interval,
          daysOfWeek: existing.daysOfWeek,
          timeOfDay: existing.timeOfDay,
          startDate: null,
        })

        const updated = await prisma.autoBuySchedule.update({
          where: { id: existing.id },
          data: {
            status: 'Active',
            anchorAt,
            nextRunAt: computeNextRun(
              {
                frequency: existing.frequency,
                interval: existing.interval,
                unit: existing.unit as 'hours' | 'days' | 'weeks' | 'months',
                daysOfWeek: existing.daysOfWeek,
                timeOfDay: existing.timeOfDay,
                timezone: existing.timezone,
                anchorAt,
              },
              now
            ),
            pendingSlot: null,
            consecutiveFailures: 0,
            consentAt: input.consent === true ? now : existing.consentAt,
            updatedAt: now,
          },
        })

        return NextResponse.json({
          success: true,
          schedule: presentSchedule(updated),
        })
      }

      const paused = await prisma.autoBuySchedule.update({
        where: { id: existing.id },
        data: { status: 'Paused', pendingSlot: null, updatedAt: now },
      })
      return NextResponse.json({ success: true, schedule: presentSchedule(paused) })
    }

    // ── Edit the rule ───────────────────────────────────────────────
    const frequency = input.frequency ?? existing.frequency
    let interval = existing.interval
    let unit = existing.unit as 'hours' | 'days' | 'weeks' | 'months'
    try {
      const resolved = resolveInterval(
        frequency,
        input.interval ?? (frequency === 'custom' ? existing.interval : undefined),
        input.unit ??
          (frequency === 'custom'
            ? (existing.unit as 'hours' | 'days' | 'weeks' | 'months')
            : undefined)
      )
      interval = resolved.interval
      unit = resolved.unit
    } catch {
      return NextResponse.json({ error: 'Unknown frequency' }, { status: 400 })
    }

    const daysOfWeek =
      input.daysOfWeek !== undefined
        ? normalizeDaysOfWeek(input.daysOfWeek)
        : existing.daysOfWeek
    if (unit === 'weeks' && daysOfWeek.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one day of the week' },
        { status: 400 }
      )
    }

    const network = input.network ?? existing.network
    const planType = input.planType ?? existing.planType
    const planGb = input.planGb ?? existing.planGb
    const planDays = input.planDays ?? existing.planDays

    // Re-check the bundle: an edited rule must point at something that is
    // actually on sale, at the current price.
    const bundle = await resolveBundleFromCatalogue({
      network,
      planType,
      planGb,
      planDays,
      planId: input.planId ?? existing.planId,
    })
    if (!bundle.available) {
      return NextResponse.json(
        { error: bundle.reason ?? 'This bundle is not available' },
        { status: 400 }
      )
    }

    const timeOfDay = input.timeOfDay ?? existing.timeOfDay
    const timezone = input.timezone ?? existing.timezone ?? DEFAULT_TIMEZONE

    const anchorAt = resolveAnchor({
      from: now,
      timezone,
      unit,
      interval,
      daysOfWeek,
      timeOfDay,
      startDate: input.startDate ?? null,
    })

    const updated = await prisma.autoBuySchedule.update({
      where: { id: existing.id },
      data: {
        network,
        planType,
        planGb,
        planDays,
        planId: bundle.planId,
        price: bundle.price,
        phone: input.phone ?? existing.phone,
        frequency,
        interval,
        unit,
        daysOfWeek,
        timeOfDay,
        timezone,
        anchorAt,
        nextRunAt: computeNextRun(
          {
            frequency,
            interval,
            unit,
            daysOfWeek,
            timeOfDay,
            timezone,
            anchorAt,
          },
          now
        ),
        pendingSlot: null,
        consecutiveFailures: 0,
        updatedAt: now,
      },
    })

    return NextResponse.json({ success: true, schedule: presentSchedule(updated) })
  } catch (error) {
    console.error('Auto-Buy update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const existing = await prisma.autoBuySchedule.findFirst({
      where: { id: params.id, userId },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    // Executions and linked transactions are removed by the cascade rules.
    await prisma.autoBuySchedule.delete({ where: { id: existing.id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Auto-Buy delete error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
