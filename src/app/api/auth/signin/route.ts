import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signinSchema } from '@/lib/validators'
import { signToken } from '@/lib/auth'
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
