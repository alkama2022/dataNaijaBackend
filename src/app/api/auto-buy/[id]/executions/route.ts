import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { presentExecution } from '@/lib/auto_buy/presenter'

/**
 * Execution history for a single Auto-Buy rule.
 *
 * Query params: ?status=All|Successful|Failed|Skipped|Pending
 *
 * Protected route — a customer can only read the history of their own rule.
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

    const schedule = await prisma.autoBuySchedule.findFirst({
      where: { id: params.id, userId },
    })
    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status') || 'All'

    const executions = await prisma.autoBuyExecution.findMany({
      where: {
        scheduleId: schedule.id,
        userId,
        ...(statusFilter !== 'All' ? { status: statusFilter } : {}),
      },
      orderBy: { scheduledFor: 'desc' },
      take: 100,
    })

    return NextResponse.json(executions.map(presentExecution))
  } catch (error) {
    console.error('Auto-Buy executions error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
