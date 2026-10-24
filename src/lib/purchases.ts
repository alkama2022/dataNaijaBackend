import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

/**
 * Buying a data bundle.
 *
 * The rules that keep the money safe live here, away from the HTTP layer,
 * so they can be read and tested on their own:
 *
 *  1. **The price comes from the catalogue.** What the client sends is
 *     never trusted — the bundle is looked up and the catalogue price is
 *     what the customer is charged.
 *  2. **The debit is conditional.** `updateMany` with `balance: { gte }`
 *     means the wallet can never go negative, even when two purchases
 *     arrive at the same time.
 *  3. **The reference is random.** A clock based reference collides when
 *     two purchases land in the same millisecond.
 *  4. **A repeated request is not charged twice.** The client can send an
 *     `Idempotency-Key`; the same key always returns the first result.
 */

/** The reason a purchase could not be completed. */
export type PurchaseFailure =
  | 'user-not-found'
  | 'bundle-unavailable'
  | 'insufficient-funds'

/** A purchase that did not happen, with the reason why. */
export class PurchaseError extends Error {
  readonly reason: PurchaseFailure
  readonly status: number

  constructor(reason: PurchaseFailure, message: string, status: number) {
    super(message)
    this.reason = reason
    this.status = status
  }
}

export interface PurchaseInput {
  userId: string
  /** The network the bundle is for, e.g. `MTN`. */
  network: string
  /** The bundle the customer picked, e.g. `1GB - 30 Days`. */
  type: string
  /** The bundle family, e.g. `SME`. Two families sell the same size. */
  dataType?: string | null
  /** The id of the catalogue row, when the client knows it. */
  planId?: string | null
  /** The recipient number. */
  phone: string
  /**
   * A key that identifies this purchase attempt. Sending the same key
   * again returns the first result instead of charging again.
   */
  idempotencyKey?: string | null
}

export interface PurchaseTransaction {
  id: string
  title: string
  subtitle: string
  amount: number
  status: string
  phone: string
  ref: string
}

export interface PurchaseResult {
  transaction: PurchaseTransaction
  /** The wallet balance after the purchase. */
  newBalance: number
  /** True when this was a repeat of a purchase that already happened. */
  replayed: boolean
}

/**
 * A purchase reference.
 *
 * The suffix is random rather than taken from the clock, so two purchases
 * in the same millisecond still get different references.
 */
export function generateReference(): string {
  return 'DN' + randomBytes(8).toString('hex').toUpperCase()
}

/** True for a Postgres unique-constraint violation (Prisma error P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  )
}

/**
 * Looks the bundle up in the catalogue.
 *
 * The customer can send the plan id, or the bundle they picked. The
 * lookup never guesses: when more than one plan matches, the purchase is
 * refused rather than charging the wrong price.
 */
export async function resolveBundle(input: {
  network: string
  type: string
  dataType?: string | null
  planId?: string | null
}) {
  if (input.planId) {
    const plan = await prisma.dataPlan.findUnique({
      where: { id: input.planId },
      include: { network: true },
    })
    if (!plan || !plan.isActive) return null
    return plan
  }

  const plans = await prisma.dataPlan.findMany({
    where: { network: { name: input.network }, isActive: true },
    include: { network: true },
  })

  const wanted = input.type.trim().toLowerCase()
  const family = input.dataType?.trim().toLowerCase()

  // The plan id is the exact identity of a bundle.
  const byId = plans.find((plan) => plan.id.toLowerCase() === wanted)
  if (byId) return byId

  // With the data family, the bundle is identified exactly. The lookup
  // stops here: a family that does not match is a bundle that is not
  // available, never a different family with the same size.
  if (family) {
    const byFamily = plans.filter(
      (plan) =>
        plan.type.toLowerCase() === family &&
        (`${plan.gb} - ${plan.days}`.toLowerCase() === wanted ||
          plan.gb.toLowerCase() === wanted)
    )
    return byFamily.length === 1 ? byFamily[0] : null
  }

  // "SME 1GB - 30 Days" — the data type, the size and the duration.
  const byFullLabel = plans.filter(
    (plan) => `${plan.type} ${plan.gb} - ${plan.days}`.toLowerCase() === wanted
  )
  if (byFullLabel.length === 1) return byFullLabel[0]
  if (byFullLabel.length > 1) return null

  // "1GB - 30 Days" — the size and the duration.
  const bySizeAndDuration = plans.filter(
    (plan) => `${plan.gb} - ${plan.days}`.toLowerCase() === wanted
  )
  if (bySizeAndDuration.length === 1) return bySizeAndDuration[0]
  if (bySizeAndDuration.length > 1) return null

  // "1GB" — only when it is unambiguous. Two data types sell a 1GB
  // bundle, so this must not pick one of them.
  const bySize = plans.filter((plan) => plan.gb.toLowerCase() === wanted)
  if (bySize.length === 1) return bySize[0]

  return null
}

/** The key is scoped to the customer, so two customers can use the same one. */
function scopedKey(userId: string, key?: string | null): string | null {
  const trimmed = key?.trim()
  if (!trimmed) return null
  return `${userId}:${trimmed.slice(0, 120)}`
}

/** Shapes a transaction for the API. */
function present(transaction: {
  id: string
  title: string
  subtitle: string
  amount: number
  status: string
  phone: string
  ref: string
}): PurchaseTransaction {
  return {
    id: transaction.id,
    title: transaction.title,
    subtitle: transaction.subtitle,
    amount: transaction.amount,
    status: transaction.status,
    phone: transaction.phone,
    ref: transaction.ref,
  }
}

/**
 * Buys a data bundle.
 *
 * Throws a [PurchaseError] when the purchase cannot be completed.
 */
export async function purchaseDataBundle(
  input: PurchaseInput
): Promise<PurchaseResult> {
  const key = scopedKey(input.userId, input.idempotencyKey)

  // A repeated request returns the first result instead of charging again.
  if (key) {
    const existing = await prisma.transaction.findUnique({
      where: { idempotencyKey: key },
    })
    if (existing) {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
      })
      return {
        transaction: present(existing),
        newBalance: user?.balance ?? 0,
        replayed: true,
      }
    }
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId } })
  if (!user) {
    throw new PurchaseError('user-not-found', 'User not found.', 404)
  }

  const plan = await resolveBundle({
    network: input.network,
    type: input.type,
    dataType: input.dataType,
    planId: input.planId,
  })
  if (!plan) {
    throw new PurchaseError(
      'bundle-unavailable',
      'This bundle is not available.',
      400
    )
  }

  const price = plan.price
  const ref = generateReference()

  try {
    const result = await prisma.$transaction(async (tx) => {
      // The debit is conditional, so two purchases that arrive at the same
      // time can never take the wallet below zero.
      const deducted = await tx.user.updateMany({
        where: { id: input.userId, balance: { gte: price } },
        data: { balance: { decrement: price } },
      })
      if (deducted.count === 0) {
        throw new PurchaseError(
          'insufficient-funds',
          'Not enough balance. Fund your wallet.',
          400
        )
      }

      const transaction = await tx.transaction.create({
        data: {
          userId: input.userId,
          title: 'Data Purchase',
          subtitle: `${plan.network.name} ${plan.gb} - ${plan.days}`,
          amount: -price,
          status: 'Successful',
          phone: input.phone,
          ref,
          typeKey: 'd',
          date: new Date(),
          idempotencyKey: key,
        },
      })

      const updated = await tx.user.findUnique({ where: { id: input.userId } })
      return { transaction, newBalance: updated?.balance ?? 0 }
    })

    return {
      transaction: present(result.transaction),
      newBalance: result.newBalance,
      replayed: false,
    }
  } catch (error) {
    // A parallel request with the same key already did the work, and the
    // transaction was rolled back, so nothing was charged twice.
    if (isUniqueViolation(error) && key) {
      const existing = await prisma.transaction.findUnique({
        where: { idempotencyKey: key },
      })
      if (existing) {
        const updated = await prisma.user.findUnique({
          where: { id: input.userId },
        })
        return {
          transaction: present(existing),
          newBalance: updated?.balance ?? 0,
          replayed: true,
        }
      }
    }
    throw error
  }
}
