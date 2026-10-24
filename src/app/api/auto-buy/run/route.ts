import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runDueAutoBuySchedules } from '@/lib/auto_buy/runner'
import { presentSchedule } from '@/lib/auto_buy/presenter'

/**
 * Scheduler entry point.
 *
 * This route is called by the platform scheduler (Vercel Cron, a system
 * cron job or the bundled worker) — never by the mobile app. It is
 * protected by a shared secret so a customer cannot trigger other
 * customers' purchases.
 *
 * Configure the secret in the hosting environment:
 *   CRON_SECRET="some-long-random-string"
 *
 * Vercel sends it as `Authorization: Bearer <CRON_SECRET>`.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${secret}`) return true

  const header = request.headers.get('x-cron-secret')
  return header === secret
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()
    const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'

    if (dryRun) {
      const due = await prisma.autoBuySchedule.findMany({
        where: {
          status: 'Active',
          nextRunAt: { lte: now },
          OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
        },
        orderBy: { nextRunAt: 'asc' },
        take: 100,
      })
      return NextResponse.json({
        dryRun: true,
        due: due.map(presentSchedule),
      })
    }

    const summary = await runDueAutoBuySchedules({ now })
    return NextResponse.json({ success: true, ...summary })
  } catch (error) {
    console.error('Auto-Buy run error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Vercel Cron issues GET requests; POST is handy for manual triggers and
// for the bundled worker.
export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
