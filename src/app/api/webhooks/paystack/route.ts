import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { creditWalletAfterSuccessfulPayment, isValidWebhookSignature } from '@/lib/payments'

/**
 * Paystack webhook: credits the wallet when a charge succeeds.
 *
 * The signature is verified before anything is credited, and the credit
 * itself is idempotent (unique `Transaction.ref`), so a retried or repeated
 * delivery can never double-credit.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-paystack-signature')
  const timestamp = request.headers.get('x-paystack-request-timestamp')
  const rawBody = await request.text()

  const valid = isValidWebhookSignature({
    secret: process.env.PAYSTACK_SECRET_KEY ?? '',
    method: 'POST',
    path: '/api/webhooks/paystack',
    rawBody,
    timestamp,
    signature,
  })

  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: {
    event?: string
    data?: { reference?: string; amount?: number };
  }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  if (event?.event === 'charge.successful') {
    const ref = event.data?.reference
    const amount = event.data?.amount ? Math.floor(event.data.amount / 100) : 0
    if (ref && amount > 0) {
      const funding = await prisma.transaction.findUnique({ where: { ref } })
      if (funding && funding.typeKey === 'w') {
        const credit = await creditWalletAfterSuccessfulPayment({
          userId: funding.userId,
          amount,
          ref,
          title: funding.title,
          subtitle: funding.subtitle,
        })
        return NextResponse.json({ status: 'ok', credited: credit.credited })
      }
    }
  }

  return NextResponse.json({ status: 'ok' })
}
