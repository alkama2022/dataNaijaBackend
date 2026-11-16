/**
 * Provider routing for incoming purchases.
 *
 * Picks the provider that should take an order, using the same rules the
 * admin panel shows (`smart` score vs `cheapest`) and the same eligibility
 * filters: a provider that is switched off, is down or cannot afford the
 * order is skipped.
 */

import { prisma } from '@/lib/prisma'
import { getSettings, settingNumber } from '@/lib/admin/settings'
import { getProviderHealth, type ProviderHealthRow } from '@/lib/admin/analytics'
import {
  rankProviders,
  planMargin,
  type ProviderCandidate,
  type RankedProvider,
  type RoutingMode,
  type RoutingWeights,
} from '@/lib/admin/routing'

export interface ProviderSelection {
  providerId: string | null
  cost: number | null
  margin: number | null
  ranked: RankedProvider[]
}

/**
 * Ranks the providers that can take a plan and returns the winner.
 *
 * The purchase flow uses this to decide who took the order, so the provider
 * that delivered a transaction is always the one the routing rules picked.
 */
export async function selectProviderForPlan(input: {
  planId: string
  sellPrice: number
}): Promise<ProviderSelection> {
  const [plan, settings, health] = await Promise.all([
    prisma.dataPlan.findUnique({
      where: { id: input.planId },
      select: { id: true, price: true, network: { select: { name: true } } },
    }),
    getSettings(),
    getProviderHealth(),
  ])

  if (!plan) {
    return { providerId: null, cost: null, margin: null, ranked: [] }
  }

  const costs = await prisma.providerPlanCost.findMany({
    where: { planId: input.planId },
  })
  const costByProvider = new Map<string, number>()
  for (const cost of costs) {
    costByProvider.set(cost.providerId, cost.cost)
  }
  const healthById = new Map<string, ProviderHealthRow>()
  for (const row of health) {
    healthById.set(row.id, row)
  }

  const candidates: ProviderCandidate[] = (
    await prisma.provider.findMany()
  ).map((provider) => {
    const stats = healthById.get(provider.id)
    return {
      providerId: provider.id,
      name: provider.name,
      cost: costByProvider.get(provider.id) ?? null,
      isActive: provider.isActive,
      isDown: provider.isDown,
      walletBalance: provider.walletBalance,
      reliability: stats?.reliability ?? 100,
      faultRate: stats?.faultRate ?? 0,
      availability: provider.uptimePercent,
    }
  })

  const weights: RoutingWeights = {
    price: settingNumber(settings, 'routing.weight.price', 40),
    reliability: settingNumber(settings, 'routing.weight.reliability', 30),
    fault: settingNumber(settings, 'routing.weight.fault', 20),
    availability: settingNumber(settings, 'routing.weight.availability', 10),
  }
  const mode: RoutingMode =
    settings['routing.mode'] === 'cheap' ? 'cheap' : 'smart'

  const ranked = rankProviders(candidates, weights, mode)
  const top = ranked[0] ?? null

  return {
    providerId: top?.providerId ?? null,
    cost: top?.cost ?? null,
    margin: planMargin(input.sellPrice, ranked),
    ranked,
  }
}
