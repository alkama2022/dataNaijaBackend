import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { kycSchema } from '@/lib/validators'
import { verifyKycIdentity } from '@/lib/kyc'
import { consume } from '@/lib/rate-limit'

/**
 * Submit KYC (BVN or NIN) for verification.
 * Protected route.
 *
 * The verification itself is delegated to a real identity provider. The
 * account is only marked verified when that provider confirms; a failed or
 * unconfigured provider never marks the account verified.
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

    const { type, id } = parsed.data

    const rateLimit = consume(`kyc:${(payload as { userId: string }).userId}`, { limit: 3, windowMs: 60 * 60_000 })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many verification attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateLimit.retryAfterMs / 1000)) } }
      )
    }

    const verification = await verifyKycIdentity({ type, id })
    if (!verification.verified) {
      return NextResponse.json(
        { success: false, verified: false, error: verification.error ?? 'Verification failed.' },
        { status: 400 }
      )
    }

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
