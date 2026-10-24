import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signupSchema } from '@/lib/validators'
import { signToken } from '@/lib/auth'
import bcrypt from 'bcryptjs'

/**
 * Create a new account.
 * Generates a referral code from the user's name + random suffix.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const parsed = signupSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { fullName, phone, email, password } = parsed.data

    // Check if phone or email already exists
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ phone }, ...(email ? [{ email }] : [])],
      },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'Account already exists with this phone or email' },
        { status: 409 }
      )
    }

    // Generate a simple unique referral code: first letters of name + 4 random digits
    const referralCode =
      fullName
        .split(' ')
        .map((part) => part[0]?.toUpperCase())
        .join('') +
      Math.floor(1000 + Math.random() * 9000)

    const passwordHash = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        fullName,
        phone,
        email,
        passwordHash,
        referralCode,
        balance: 5000, // Starting balance matches Flutter MockData
      },
    })

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
        referralBonus: user.referralBonus,
      },
    })
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
