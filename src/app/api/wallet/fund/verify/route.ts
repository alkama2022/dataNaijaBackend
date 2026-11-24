import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { creditWalletAfterSuccessfulPayment, verifyPayment } from '@/lib/payments'

/**
 * Verify a wallet funding payment and credit the wallet once it succeeded.
 * Protected route.
 *
 * The customer pays through the `authorizationUrl` returned by
 * `POST /api/wallet/fund`; this endpoint confirms with the gateway before
 * crediting. It is idempotent — the unique constraint on `Transaction.ref`
 * makes a repeated call a no-op.
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

    const body = (await request.json().catch(() => null)) as { reference?: string } | null
    const reference = body?.reference
    if (!reference || typeof reference !== 'string') {
      return NextResponse.json(
        { error: 'Invalid input', details: { reference: ['Reference is required'] } },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: (payload as { userId: string }).userId },
      select: { id: true, balance: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const verification = await verifyPayment(reference)
    if (!verification || !verification.success) {
      return NextResponse.json({ success: false, error: 'Payment not completed' }, { status: 400 })
    }

    const amount =
      verification.amount && verification.amount > 0 ? Math.floor(verification.amount / 100) : 0
    if (amount <= 0) {
      return NextResponse.json({ success: true, credited: false, newBalance: user.balance })
    }

    const credit = await creditWalletAfterSuccessfulPayment({
      userId: user.id,
      amount,
      ref: reference,
      title: 'Wallet Funding',
      subtitle: 'Card Payment',
    })

    return NextResponse.json({ success: true, credited: credit.credited, newBalance: credit.balance })
  } catch (error) {
    console.error('Fund wallet verify error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
