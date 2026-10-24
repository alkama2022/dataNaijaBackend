import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { purchaseSchema } from '@/lib/validators'
import { PurchaseError, purchaseDataBundle } from '@/lib/purchases'

/**
 * Purchase a data bundle.
 * Protected route: requires `Authorization: Bearer <token>`.
 *
 * The money rules live in `src/lib/purchases.ts`:
 *  1. the price comes from the catalogue, never from the client;
 *  2. the debit is conditional, so the wallet can never go negative;
 *  3. the reference is random, so two purchases never collide;
 *  4. an `Idempotency-Key` header makes a retried request free.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let payload
    try {
      payload = await verifyToken(authHeader.slice(7))
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = purchaseSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { network, type, dataType, phone, planId } = parsed.data

    const result = await purchaseDataBundle({
      userId: (payload as { userId: string }).userId,
      network,
      type,
      dataType,
      planId,
      phone,
      idempotencyKey: request.headers.get('idempotency-key'),
    })

    return NextResponse.json({
      success: true,
      transaction: result.transaction,
      newBalance: result.newBalance,
      replayed: result.replayed,
    })
  } catch (error) {
    if (error instanceof PurchaseError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Purchase error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
