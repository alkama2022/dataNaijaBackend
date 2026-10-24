import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { kycSchema } from '@/lib/validators'

/**
 * Submit KYC (BVN or NIN) for verification.
 * Protected route.
 *
 * This simulates a verification partner check. In production you would call
 * a real identity verification API (NIBSS, NIMC, or a third-party provider)
 * here before setting kycVerified = true.
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
    const parsed = kycSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { type, id, consent } = parsed.data

    // Simulated verification delay and success
    await new Promise((resolve) => setTimeout(resolve, 1400))

    const user = await prisma.user.update({
      where: { id: (payload as { userId: string }).userId },
      data: {
        kycVerified: true,
        kycType: type,
        kycId: id,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Verified. Your account number is ready.',
      user: {
        id: user.id,
        kycVerified: user.kycVerified,
        kycType: user.kycType,
      },
    })
  } catch (error) {
    console.error('KYC verify error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
