import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { presentSchedule, presentExecution } from '@/lib/auto_buy/presenter'

/**
 * Admin view of a single Auto-Buy rule and its execution history.
 *
 * Support staff use this when a customer reports that an automatic purchase
 * did not happen. See `src/app/api/admin/auto-buy/route.ts` for the
 * authentication rules.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const schedule = await prisma.autoBuySchedule.findUnique({
      where: { id: params.id },
      include: {
        user: { select: { id: true, fullName: true, phone: true, balance: true } },
      },
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
      schedule: {
        ...presentSchedule(schedule),
        customer: {
          id: schedule.user.id,
          fullName: schedule.user.fullName,
          phone: schedule.user.phone,
          balance: schedule.user.balance,
        },
      },
      executions: executions.map(presentExecution),
    })
  } catch (error) {
    console.error('Admin auto-buy detail error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Lets support pause or resume a customer's rule. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const status = body?.status

    if (status !== 'Active' && status !== 'Paused') {
      return NextResponse.json(
        { error: 'status must be Active or Paused' },
        { status: 400 }
      )
    }

    const schedule = await prisma.autoBuySchedule.findUnique({
      where: { id: params.id },
    })
    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const updated = await prisma.autoBuySchedule.update({
      where: { id: schedule.id },
      data: { status, pendingSlot: null },
    })

    return NextResponse.json({ success: true, schedule: presentSchedule(updated) })
  } catch (error) {
    console.error('Admin auto-buy update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Checks the shared admin key. */
function isAuthorized(request: NextRequest): boolean {
  const key = process.env.ADMIN_API_KEY
  if (!key) return false

  const header = request.headers.get('x-admin-key')
  if (header === key) return true

  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${key}`
}
