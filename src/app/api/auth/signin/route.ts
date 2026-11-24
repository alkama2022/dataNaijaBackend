import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signinSchema } from '@/lib/validators'
import { signToken } from '@/lib/auth'
import { consume } from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'

/**
 * Sign in with phone number and password.
 * On success returns a JWT that Flutter stores in SharedPreferences and sends
 * back as `Authorization: Bearer <token>` on subsequent requests.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate input against the same rules the Flutter app enforces.
    const parsed = signinSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { phone, password } = parsed.data

    const rateLimit = consume(`signin:${phone}`, { limit: 5, windowMs: 15 * 60_000 })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateLimit.retryAfterMs / 1000)) } }
      )
    }

    const user = await prisma.user.findUnique({ where: { phone } })
    if (!user) {
      // Generic message to prevent phone enumeration.
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash)
    if (!passwordMatches) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = await signToken({
      userId: user.id as string,
      phone: user.phone,
    } as { userId: string; phone: string })

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        balance: user.balance,
        kycVerified: user.kycVerified,
        fingerprintEnabled: user.fingerprintEnabled,
        balanceHidden: user.balanceHidden,
        referralBonus: user.referralBonus,
      },
    })
  } catch (error) {
    console.error('Signin error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
