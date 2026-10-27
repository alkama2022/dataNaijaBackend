import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { transactionReportSchema } from '@/lib/validators'

/**
 * Submit a transaction report (support ticket).
 * Protected route: requires `Authorization: Bearer <token>`.
 *
 * The customer picks a transaction (from their own history) and describes the
 * issue. The transaction is looked up with BOTH the transaction id and the
 * authenticated user's id, so a customer can never attach a report to another
 * customer's transaction. The report is persisted with a backend-generated
 * id and a `Received` status; support owns the lifecycle afterwards.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.slice(7)

    let payload
    try {
      payload = await verifyToken(token)
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = transactionReportSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { transactionId, category, message } = parsed.data

    const transaction = await prisma.transaction.findFirst({
      where: {
        id: transactionId,
        userId: (payload as { userId: string }).userId,
      },
    })

    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    const report = await prisma.transactionReport.create({
      data: {
        transactionId,
        userId: (payload as { userId: string }).userId,
        category,
        message,
      },
    })

    return NextResponse.json({
      success: true,
      report: {
        id: report.id,
        transactionId: report.transactionId,
        category: report.category,
        status: report.status,
        createdAt: report.createdAt,
      },
    })
  } catch (error) {
    console.error('Transaction report error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
