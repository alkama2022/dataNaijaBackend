import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

/**
 * Return the current user's referral information:
 * bonus balance, referral code, and list of referred friends.
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
      select: {
        id: true,
        referralCode: true,
        referralBonus: true,
        referrals: {
          select: {
            id: true,
            friendName: true,
            friendStatus: true,
            earned: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      referralCode: user.referralCode,
      referralBonus: user.referralBonus,
      friends: user.referrals.map((f: { id: string; friendName: string; friendStatus: string; earned: number }) => ({
        id: f.id,
        name: f.friendName,
        status: f.friendStatus,
        earned: f.earned,
      })),
    })
  } catch (error) {
    console.error('Referral error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
