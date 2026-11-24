import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { fundSchema } from '@/lib/validators'
import { generateReference } from '@/lib/purchases'
import { createPayment, isGatewayConfigured } from '@/lib/payments'
import { consume } from '@/lib/rate-limit'

/**
 * Fund the wallet.
 * Protected route.
 *
 * When a live payment gateway is configured (`PAYSTACK_SECRET_KEY`), this
 * endpoint only creates a hosted payment and returns the `authorizationUrl`
 * the customer pays through. The wallet is credited later, after the gateway
 * confirms — through `/api/wallet/fund/verify` or the Paystack webhook.
 *
 * When no gateway is configured the route falls back to the local
 * development simulation, so the app can run without external services.
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

    // Live gateway mode: create the hosted payment. No credit happens here.
    if (isGatewayConfigured()) {
      const payment = await createPayment({
        amount,
        email: user.email ?? `${user.phone}@datanaija.local`,
      })

      return NextResponse.json({
        success: false,
        requiresPayment: true,
        authorizationUrl: payment.authorizationUrl,
        reference: payment.reference,
        amount,
      })
    }

    // Development fallback: simulated instant credit.
    const ref = generateReference()

    const rateLimit = consume(`fund:${user.id}`, { limit: 3, windowMs: 60 * 60_000 })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many funding attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateLimit.retryAfterMs / 1000)) } }
      )
    }

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
