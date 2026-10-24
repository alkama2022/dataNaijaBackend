import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { fundSchema } from '@/lib/validators'

/**
 * Fund the wallet (simulated).
 * Protected route.
 *
 * In production this would integrate with a real payment gateway (Paystack,
 * Flutterwave, etc.) and verify the webhook before crediting. For now it
 * simulates an instant credit, matching the Flutter demo behavior.
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
    const parsed = fundSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { amount, method } = parsed.data

    const user = await prisma.user.findUnique({
      where: { id: (payload as { userId: string }).userId },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const ref = 'DN' + Date.now().toString().slice(-9)

    // Credit balance and create transaction atomically
    const result = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { balance: { increment: amount } },
      }),
      prisma.transaction.create({
        data: {
          userId: user.id,
          title: 'Wallet Funding',
          subtitle: method,
          amount,
          status: 'Successful',
          phone: '-',
          ref,
          typeKey: 'w',
          date: new Date(),
        },
      }),
    ])

    return NextResponse.json({
      success: true,
      transaction: {
        id: result[1].id,
        title: result[1].title,
        subtitle: result[1].subtitle,
        amount: result[1].amount,
        status: result[1].status,
        ref: result[1].ref,
      },
      newBalance: result[0].balance,
    })
  } catch (error) {
    console.error('Fund wallet error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
