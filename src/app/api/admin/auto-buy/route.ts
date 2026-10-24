import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { presentSchedule } from '@/lib/auto_buy/presenter'

/**
 * Admin view of every Auto-Buy rule.
 *
 * The admin panel (`adminPannel/`) is a design mock-up today. This route is
 * the API it will need: a single place that lists every customer's rule
 * with its status, next purchase and recent failures, so support staff can
 * see what the scheduler is doing.
 *
 * Authentication uses a shared key (`ADMIN_API_KEY`). Wire it to the admin
 * panel's own session layer when that panel becomes a real application:
 *
 *   curl -H "x-admin-key: $ADMIN_API_KEY" http://localhost:3000/api/admin/auto-buy
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'All'

    const schedules = await prisma.autoBuySchedule.findMany({
      where: status !== 'All' ? { status } : undefined,
      include: {
        user: { select: { id: true, fullName: true, phone: true, balance: true } },
        _count: { select: { executions: true } },
      },
      orderBy: { nextRunAt: 'asc' },
      take: 200,
    })

    const rows = schedules.map((schedule) => ({
      ...presentSchedule(schedule),
      customer: {
        id: schedule.user.id,
        fullName: schedule.user.fullName,
        phone: schedule.user.phone,
        balance: schedule.user.balance,
      },
      executionCount: schedule._count.executions,
    }))

    return NextResponse.json(rows)
  } catch (error) {
    console.error('Admin auto-buy list error:', error)
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
