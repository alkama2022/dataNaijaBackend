import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

/**
 * Return the current user's wallet balance.
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

    const user = await prisma.user.findUnique({
      where: { id: (payload as { userId: string }).userId },
      select: { id: true, balance: true, balanceHidden: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      balance: user.balance,
      balanceHidden: user.balanceHidden,
    })
  } catch (error) {
    console.error('Wallet balance error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
