import { prisma } from '@/lib/prisma'

/**
 * The order operations the admin panel can perform.
 *
 * They live here, away from the server actions, so the rules — especially
 * the ones that move money — can be tested on their own.
 */

/** A problem the admin needs to see, with a message they can act on. */
export class OrderError extends Error {}

/**
 * Marks a held order as delivered.
 *
 * Only orders that are still held can be marked — a delivered or a
 * refunded order is left alone, so the action cannot be replayed.
 */
export async function markOrderDelivered(
  transactionId: string
): Promise<string> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
  })
  if (!transaction) {
    throw new OrderError('Order not found.')
  }
  if (transaction.status !== 'Pending') {
    throw new OrderError(
      'Only orders held for review can be marked as delivered.'
    )
  }

  const updated = await prisma.transaction.updateMany({
    where: { id: transactionId, status: 'Pending' },
    data: { status: 'Successful' },
  })
  if (updated.count !== 1) {
    throw new OrderError('This order was already updated. Refresh and try again.')
  }

  return transaction.ref
}

/**
 * Refunds a held order and credits the customer's wallet.
 *
 * The status change and the credit happen in one transaction, so the
 * money can never be refunded twice. Only held orders can be refunded.
 */
export async function refundHeldOrder(
  transactionId: string
): Promise<{ amount: number; customer: string; ref: string }> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { user: { select: { fullName: true } } },
  })
  if (!transaction) {
    throw new OrderError('Order not found.')
  }
  if (transaction.status !== 'Pending') {
    throw new OrderError('Only orders held for review can be refunded.')
  }

  const amount = Math.abs(transaction.amount)

  const refunded = await prisma.$transaction(async (tx) => {
    const update = await tx.transaction.updateMany({
      where: { id: transactionId, status: 'Pending' },
      data: { status: 'Failed' },
    })
    if (update.count !== 1) return false
    await tx.user.update({
      where: { id: transaction.userId },
      data: { balance: { increment: amount } },
    })
    return true
  })
  if (!refunded) {
    throw new OrderError('This order was already updated. Refresh and try again.')
  }

  return { amount, customer: transaction.user.fullName, ref: transaction.ref }
}
