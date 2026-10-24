/**
 * Provider routing.
 *
 * When an order comes in we have to pick the provider that takes it.
 * The rules come straight from the design mockup:
 *
 *  - a provider that is switched off, is down, or cannot afford the order
 *    is skipped;
 *  - in "smart" mode every eligible provider gets a score between 0 and 1
 *    from price, reliability, fault rate and availability, and the
 *    highest score wins;
 *  - in "cheapest" mode the cheapest provider wins, and reliability only
 *    breaks ties.
 *
 * The maths is kept here, away from the database, so it can be tested on
 * its own.
 */

export interface ProviderCandidate {
  providerId: string
  name: string
  /** What the provider charges for this plan. `null` when they do not sell it. */
  cost: number | null
  isActive: boolean
  isDown: boolean
  /** The provider's own wallet balance, in Naira. */
  walletBalance: number
  /** Delivery success rate over the last 7 days, 0-100. */
  reliability: number
  /** Error rate over the last 24 hours, 0-100. */
  faultRate: number
  /** Uptime from the health checks, 0-100. */
  availability: number
}

export interface RoutingWeights {
  price: number
  reliability: number
  fault: number
  availability: number
}

export type RoutingMode = 'smart' | 'cheap'

export interface RankedProvider extends ProviderCandidate {
  /** The cost, guaranteed to be a number for every ranked provider. */
  cost: number
  /** The smart score between 0 and 1. Zero in cheapest mode. */
  score: number
}

/** Clamps a number into the 0-1 range. */
function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Ranks the providers that can take an order for a given plan.
 *
 * Providers that cannot take the order are left out entirely.
 */
export function rankProviders(
  candidates: ProviderCandidate[],
  weights: RoutingWeights,
  mode: RoutingMode = 'smart'
): RankedProvider[] {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.cost !== null &&
      candidate.isActive &&
      !candidate.isDown &&
      candidate.walletBalance >= candidate.cost
  )
  if (eligible.length === 0) return []

  const cheapest = Math.min(...eligible.map((candidate) => candidate.cost as number))
  const totalWeight =
    (weights.price || 0) +
    (weights.reliability || 0) +
    (weights.fault || 0) +
    (weights.availability || 0) ||
    1

  const ranked: RankedProvider[] = eligible.map((candidate) => {
    const cost = candidate.cost as number
    const score =
      (weights.price * (cheapest / cost) +
        weights.reliability * clamp((candidate.reliability - 90) / 10) +
        weights.fault * (1 - clamp(candidate.faultRate / 5)) +
        weights.availability * clamp((candidate.availability - 90) / 10)) /
      totalWeight

    return { ...candidate, cost, score }
  })

  if (mode === 'cheap') {
    ranked.sort(
      (a, b) => a.cost - b.cost || b.reliability - a.reliability
    )
    return ranked.map((provider) => ({ ...provider, score: 0 }))
  }

  ranked.sort((a, b) => b.score - a.score)
  return ranked
}

/**
 * The margin of a plan: what we sell it for minus what the provider
 * charges. `null` when no provider can take the plan.
 */
export function planMargin(
  sellPrice: number,
  ranked: RankedProvider[]
): number | null {
  if (ranked.length === 0) return null
  return sellPrice - ranked[0].cost
}
