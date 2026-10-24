import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

/**
 * List the current user's transactions.
 * Query params: ?status=All|Successful|Pending|Failed&query=search text
 * Protected route.
 */
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status') || 'All'
    const query = searchParams.get('q') || ''

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: (payload as { userId: string }).userId,
        ...(statusFilter !== 'All' ? { status: statusFilter } : {}),
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { subtitle: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { date: 'desc' },
    })

    return NextResponse.json(transactions)
  } catch (error) {
    console.error('Transactions error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
