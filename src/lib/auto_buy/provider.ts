/**
 * Data provider seam.
 *
 * The rest of the backend talks to the upstream VTU platform through the
 * small [DataProvider] interface defined here. The current implementation
 * resolves bundles from the local `DataPlan` catalogue and simulates the
 * delivery, which keeps the Auto-Buy rules (price re-check, availability
 * check, idempotency) honest even before a real aggregator is connected.
 *
 * To plug in a real aggregator, implement [DataProvider] and pass it to
 * `runDueAutoBuySchedules({ provider })`. Nothing else has to change.
 */

import { prisma } from '@/lib/prisma'

export interface BundleLookup {
  network: string
  planType: string
  planGb: string
  planDays: string
  planId?: string | null
}

export interface ResolvedBundle {
  /** Current price of the bundle in Naira. */
  price: number
  /** False when the bundle was removed, disabled or never existed. */
  available: boolean
  planId: string | null
  /** Why the bundle is unavailable (null when it is available). */
  reason: string | null
}

export interface ProviderPurchaseInput extends BundleLookup {
  phone: string
  /** The amount that will be charged (Naira). */
  amount: number
  /**
   * Idempotency key. The same key must never produce two deliveries, so a
   * retried Auto-Buy attempt cannot send data twice.
   */
  clientRef: string
}

export interface ProviderPurchaseResult {
  success: boolean
  /** The provider's own reference for the delivery. */
  reference?: string
  error?: string
}

export interface DataProvider {
  /** Re-check the current price and availability of a bundle. */
  resolveBundle(input: BundleLookup): Promise<ResolvedBundle>
  /** Ask the upstream platform to deliver the bundle. */
  purchase(input: ProviderPurchaseInput): Promise<ProviderPurchaseResult>
}

/**
 * Looks the bundle up in the `DataPlan` catalogue.
 *
 * The lookup is done by plan id when available and falls back to the
 * network/type/size/duration tuple so that schedules created before a plan
 * was re-issued still resolve.
 */
export async function resolveBundleFromCatalogue(
  input: BundleLookup
): Promise<ResolvedBundle> {
  const plan = input.planId
    ? await prisma.dataPlan.findUnique({ where: { id: input.planId } })
    : await prisma.dataPlan.findFirst({
        where: {
          gb: input.planGb,
          days: input.planDays,
          type: input.planType,
          network: { name: input.network },
        },
      })

  if (!plan) {
    return {
      price: 0,
      available: false,
      planId: null,
      reason: 'This bundle is no longer available.',
    }
  }

  if (!plan.isActive) {
    return {
      price: plan.price,
      available: false,
      planId: plan.id,
      reason: 'This bundle is no longer available.',
    }
  }

  return { price: plan.price, available: true, planId: plan.id, reason: null }
}

/**
 * Simulated delivery.
 *
 * `AUTO_BUY_SIMULATE_FAILURE=1` makes every purchase fail — handy for
 * rehearsing the retry policy without waiting for a real outage.
 */
export async function simulatePurchase(
  input: ProviderPurchaseInput
): Promise<ProviderPurchaseResult> {
  if (process.env.AUTO_BUY_SIMULATE_FAILURE === '1') {
    return { success: false, error: 'Provider is temporarily unavailable.' }
  }

  if (!/^0[789][01]\d{8}$/.test(input.phone)) {
    return { success: false, error: 'Invalid recipient number.' }
  }

  if (input.amount <= 0) {
    return { success: false, error: 'Invalid bundle price.' }
  }

  return { success: true, reference: `PRV${input.clientRef.slice(-8)}` }
}

/** The default provider used by the scheduler. */
export const defaultDataProvider: DataProvider = {
  resolveBundle: resolveBundleFromCatalogue,
  purchase: simulatePurchase,
}

/**
 * Builds the deterministic transaction reference for a scheduled slot.
 *
 * The reference is derived from the schedule id and the slot instant, so a
 * retried or duplicated run produces the *same* reference. Because
 * `Transaction.ref` is unique, a duplicate charge is rejected by the
 * database even if every other guard were bypassed.
 */
export function buildTransactionRef(scheduleId: string, slot: Date): string {
  const schedulePart = scheduleId.replace(/-/g, '').slice(0, 8).toUpperCase()
  const slotPart = slot.getTime().toString(36).toUpperCase()
  return `DNA${schedulePart}${slotPart}`
}
