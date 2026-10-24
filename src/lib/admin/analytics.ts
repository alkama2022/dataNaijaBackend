import { prisma } from '@/lib/prisma'
import { getZonedParts, fromFloating, floatingDate } from '@/lib/time'
import { presentSchedule } from '@/lib/auto_buy/presenter'
import {
  rankProviders,
  type ProviderCandidate,
  type RankedProvider,
  type RoutingMode,
  type RoutingWeights,
} from './routing'
import { getSettings, settingNumber } from './settings'

/**
 * The queries behind the admin panel.
 *
 * Everything the panel shows is derived from the database here, so the
 * pages stay thin and the numbers can be tested on their own.
 *
 * The business day is the Nigerian day: "today" starts at 00:00
 * Africa/Lagos, not at midnight UTC.
 */

const BUSINESS_TIMEZONE = 'Africa/Lagos'

/** The start of the Nigerian business day that contains [now]. */
export function businessDayStart(now = new Date()): Date {
  const parts = getZonedParts(now, BUSINESS_TIMEZONE)
  const midnight = floatingDate(
    parts.year,
    parts.month,
    parts.day,
    0,
    0,
    0
  )
  return fromFloating(midnight, BUSINESS_TIMEZONE)
}

/** Formats an amount the way the panel shows it: `₦1,500`. */
export function naira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString('en-NG')}`
}

/** A data transaction, with the fields the panel needs. */
interface DataTransaction {
  id: string
  amount: number
  status: string
  date: Date
  planId: string | null
  providerId: string | null
}

/** Fetches the data transactions in a window. */
async function fetchDataTransactions(
  since: Date,
  until?: Date
): Promise<DataTransaction[]> {
  return await prisma.transaction.findMany({
    where: {
      typeKey: 'd',
      date: {
        gte: since,
        ...(until ? { lt: until } : {}),
      },
    },
    select: {
      id: true,
      amount: true,
      status: true,
      date: true,
      planId: true,
      providerId: true,
    },
  })
}

/**
 * The routed cost of every (provider, plan) pair, as a lookup map.
 *
 * The table is small, so one read is cheaper and simpler than a query
 * per transaction.
 */
async function loadCostMap(): Promise<Map<string, number>> {
  const costs = await prisma.providerPlanCost.findMany({
    select: { providerId: true, planId: true, cost: true },
  })
  const map = new Map<string, number>()
  for (const cost of costs) {
    map.set(`${cost.providerId}:${cost.planId}`, cost.cost)
  }
  return map
}

/** The routed cost of a transaction, or 0 when it is unknown. */
function routedCost(
  transaction: DataTransaction,
  costMap: Map<string, number>
): number | null {
  if (!transaction.providerId || !transaction.planId) return null
  return costMap.get(`${transaction.providerId}:${transaction.planId}`) ?? null
}

// ── Overview ──────────────────────────────────────────────────────

export interface WeekPoint {
  day: string
  amount: number
  /** The share of the best day, 0-100, for the bar height. */
  share: number
}

export interface OverviewData {
  salesToday: number
  ordersToday: number
  profitToday: number | null
  profitOrdersMissingCost: number
  /** Delivery success over the last 24 hours, 0-100. */
  successRate: number | null
  week: WeekPoint[]
  needsAttention: {
    ordersHeld: number
    providersLow: number
    thinMargins: number
  }
}

/**
 * The overview screen: what the business did today, how the week looks and
 * what needs the admin's attention.
 */
export async function getOverview(now = new Date()): Promise<OverviewData> {
  const dayStart = businessDayStart(now)
  const weekStart = new Date(dayStart.getTime() - 6 * 86_400_000)

  const [today, week, last24h, weekSales, costMap] = await Promise.all([
    fetchDataTransactions(dayStart),
    fetchDataTransactions(weekStart),
    fetchDataTransactions(new Date(now.getTime() - 24 * 3_600_000)),
    fetchDataTransactions(weekStart, dayStart),
    loadCostMap(),
  ])

  const successfulToday = today.filter(
    (transaction) => transaction.status === 'Successful'
  )
  const salesToday = successfulToday.reduce(
    (sum, transaction) => sum + Math.abs(transaction.amount),
    0
  )
  let profitOrdersMissingCost = 0
  let knownCostProfit = 0
  for (const transaction of successfulToday) {
    const cost = routedCost(transaction, costMap)
    if (cost === null) {
      profitOrdersMissingCost++
      continue
    }
    knownCostProfit += Math.abs(transaction.amount) - cost
  }
  const profitToday = profitOrdersMissingCost === 0 ? knownCostProfit : null

  const successful = last24h.filter(
    (transaction) => transaction.status === 'Successful'
  ).length
  const successRate =
    last24h.length === 0 ? null : (successful / last24h.length) * 100

  // Group sales by Nigerian business day, not UTC date.
  const byDay = new Map<string, number>()
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart.getTime() + i * 86_400_000)
    byDay.set(businessDateKey(day), 0)
  }
  for (const transaction of week) {
    const key = businessDateKey(transaction.date)
    if (transaction.status === 'Successful' && byDay.has(key)) {
      byDay.set(key, (byDay.get(key) ?? 0) + Math.abs(transaction.amount))
    }
  }
  for (const transaction of weekSales) {
    const key = businessDateKey(transaction.date)
    if (transaction.status === 'Successful' && byDay.has(key)) {
      byDay.set(key, (byDay.get(key) ?? 0) + Math.abs(transaction.amount))
    }
  }

  const best = Math.max(...Array.from(byDay.values()), 1)
  const weekPoints: WeekPoint[] = Array.from(byDay.values()).map(
    (amount, index) => {
      const date = new Date(weekStart.getTime() + index * 86_400_000)
      return {
        day: date.toLocaleDateString('en-NG', {
          weekday: 'short',
          timeZone: BUSINESS_TIMEZONE,
        }),
        amount,
        share: Math.round((amount / best) * 100),
      }
    }
  )

  const [providersHeld, lowProviders, thinMargins] = await Promise.all([
    prisma.transaction.count({
      where: { typeKey: 'd', status: 'Pending' },
    }),
    countLowProviders(),
    countThinMargins(),
  ])

  return {
    salesToday,
    ordersToday: today.length,
    profitToday,
    profitOrdersMissingCost,
    successRate,
    week: weekPoints,
    needsAttention: {
      ordersHeld: providersHeld,
      providersLow: lowProviders,
      thinMargins,
    },
  }
}

/** Yesterday's sales, used for the "up on yesterday" note. */
export async function getYesterdaySales(now = new Date()): Promise<number> {
  const dayStart = businessDayStart(now)
  const yesterday = await fetchDataTransactions(
    new Date(dayStart.getTime() - 86_400_000),
    dayStart
  )
  return yesterday.reduce(
    (sum, transaction) =>
      sum +
      (transaction.status === 'Successful' ? Math.abs(transaction.amount) : 0),
    0
  )
}

function businessDateKey(date: Date): string {
  const { year, month, day } = getZonedParts(date, BUSINESS_TIMEZONE)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Providers that are down, switched off or short of money. */
async function countLowProviders(): Promise<number> {
  const providers = await prisma.provider.findMany({
    select: { isActive: true, isDown: true, walletBalance: true },
  })
  return providers.filter(
    (provider) =>
      !provider.isActive || provider.isDown || provider.walletBalance < 10_000
  ).length
}

/** Plans whose best margin is thinner than ₦30. */
async function countThinMargins(): Promise<number> {
  const margins = await getPlanMargins()
  return margins.filter((plan) => plan.margin !== null && plan.margin < 30)
    .length
}

// ── Prices and margins ────────────────────────────────────────────

export interface PlanMarginRow {
  planId: string
  name: string
  network: string
  type: string
  sellPrice: number
  isActive: boolean
  /** What each provider charges, cheapest first. */
  costs: Array<{ providerId: string; provider: string; cost: number }>
  /** The cheapest provider that can take it, or null. */
  bestCost: number | null
  /** Sell price minus the best cost. */
  margin: number | null
}

/**
 * Every plan with what the providers charge for it and the margin that
 * leaves.
 */
export async function getPlanMargins(): Promise<PlanMarginRow[]> {
  const [plans, costs, providers] = await Promise.all([
    prisma.dataPlan.findMany({
      include: { network: { select: { name: true } } },
      orderBy: { price: 'asc' },
    }),
    prisma.providerPlanCost.findMany({
      select: { providerId: true, planId: true, cost: true },
    }),
    prisma.provider.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        isDown: true,
        walletBalance: true,
      },
    }),
  ])

  const providerById = new Map(providers.map((provider) => [provider.id, provider]))

  const costsByPlan = new Map<
    string,
    Array<{ providerId: string; provider: string; cost: number }>
  >()
  for (const cost of costs) {
    const list = costsByPlan.get(cost.planId) ?? []
    list.push({
      providerId: cost.providerId,
      provider: providerById.get(cost.providerId)?.name ?? cost.providerId,
      cost: cost.cost,
    })
    costsByPlan.set(cost.planId, list)
  }

  return plans.map((plan) => {
    const planCosts = (costsByPlan.get(plan.id) ?? []).sort(
      (a, b) => a.cost - b.cost
    )
    const bestCost =
      costs
        .filter((cost) => {
          if (cost.planId !== plan.id) return false
          const provider = providerById.get(cost.providerId)
          return Boolean(
            provider?.isActive &&
              !provider.isDown &&
              provider.walletBalance >= cost.cost
          )
        })
        .reduce<number | null>(
          (best, cost) => (best === null ? cost.cost : Math.min(best, cost.cost)),
          null
        )
    return {
      planId: plan.id,
      name: `${plan.network.name} ${plan.gb} · ${plan.type} · ${plan.days}`,
      network: plan.network.name,
      type: plan.type,
      sellPrice: plan.price,
      isActive: plan.isActive,
      costs: planCosts,
      bestCost,
      margin: bestCost === null ? null : plan.price - bestCost,
    }
  })
}

// ── Providers ─────────────────────────────────────────────────────

export interface ProviderHealthRow {
  id: string
  name: string
  isActive: boolean
  isDown: boolean
  walletBalance: number
  /** Delivery success over the last 7 days, 0-100. */
  reliability: number
  /** Error rate over the last 24 hours, 0-100. */
  faultRate: number
  /** Uptime from the health checks, 0-100. */
  availability: number
  weekOrders: number
  dayOrders: number
  lastFailure: string | null
  state: 'Online' | 'Down' | 'Switched off'
  stateClass: string
  balanceWarning: string
}

/** The health of every provider, measured from the transactions. */
export async function getProviderHealth(
  now = new Date()
): Promise<ProviderHealthRow[]> {
  const providers = await prisma.provider.findMany({
    orderBy: { name: 'asc' },
  })

  const [week, day] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        typeKey: 'd',
        date: { gte: new Date(now.getTime() - 7 * 86_400_000) },
      },
      select: { providerId: true, status: true },
    }),
    prisma.transaction.findMany({
      where: {
        typeKey: 'd',
        date: { gte: new Date(now.getTime() - 24 * 3_600_000) },
      },
      select: { providerId: true, status: true },
    }),
  ])

  const countFor = (
    rows: Array<{ providerId: string | null; status: string }>,
    providerId: string,
    status?: string
  ) =>
    rows.filter(
      (row) =>
        row.providerId === providerId && (!status || row.status === status)
    ).length

  return providers.map((provider) => {
    const weekTotal = countFor(week, provider.id)
    const weekGood = countFor(week, provider.id, 'Successful')
    const dayTotal = countFor(day, provider.id)
    const dayBad = countFor(day, provider.id, 'Failed')

    const reliability = weekTotal === 0 ? 100 : (weekGood / weekTotal) * 100
    const faultRate = dayTotal === 0 ? 0 : (dayBad / dayTotal) * 100
    const low = provider.walletBalance < 10_000

    return {
      id: provider.id,
      name: provider.name,
      isActive: provider.isActive,
      isDown: provider.isDown,
      walletBalance: provider.walletBalance,
      reliability,
      faultRate,
      availability: provider.uptimePercent,
      weekOrders: weekTotal,
      dayOrders: dayTotal,
      lastFailure: provider.lastFailureAt
        ? provider.lastFailureAt.toISOString()
        : null,
      state: provider.isDown
        ? 'Down'
        : provider.isActive
          ? 'Online'
          : 'Switched off',
      stateClass: provider.isDown
        ? 'pill p-f'
        : provider.isActive
          ? 'pill p-s'
          : 'pill p-n',
      balanceWarning: low
        ? 'Low. Top up soon or orders may skip this provider.'
        : 'Healthy',
    }
  })
}

/**
 * The providers that can take a plan, best first.
 *
 * Used by the Providers tab to show who would take an order right now.
 */
export async function getProviderRanking(
  planId: string
): Promise<{ planName: string; ranked: RankedProvider[] }> {
  const [plan, providers, settings] = await Promise.all([
    prisma.dataPlan.findUnique({
      where: { id: planId },
      include: { network: { select: { name: true } } },
    }),
    prisma.provider.findMany(),
    getSettings(),
  ])

  if (!plan) return { planName: '', ranked: [] }

  const costs = await prisma.providerPlanCost.findMany({
    where: { planId },
  })
  const costByProvider = new Map(
    costs.map((cost) => [cost.providerId, cost.cost])
  )

  const health = await getProviderHealth()
  const healthById = new Map(health.map((row) => [row.id, row]))

  const candidates: ProviderCandidate[] = providers.map((provider) => {
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

  return {
    planName: `${plan.network.name} ${plan.gb}`,
    ranked: rankProviders(candidates, weights, mode),
  }
}

// ── Users ─────────────────────────────────────────────────────────

export interface UserRow {
  id: string
  name: string
  phone: string
  wallet: number
  orders: number
  role: string
  isSuspended: boolean
  status: string
  statusClass: string
}

/** The customer list, with a search box and a status filter. */
export async function getUserRows(
  search = '',
  filter = 'All'
): Promise<UserRow[]> {
  const users = await prisma.user.findMany({
    include: {
      _count: { select: { transactions: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const query = search.trim().toLowerCase()

  return users
    .filter((user) => {
      if (filter === 'Active' && user.isSuspended) return false
      if (filter === 'Suspended' && !user.isSuspended) return false
      if (query === '') return true
      return (
        user.fullName.toLowerCase().includes(query) ||
        user.phone.includes(query)
      )
    })
    .map((user) => ({
      id: user.id,
      name: user.fullName,
      phone: user.phone,
      wallet: user.balance,
      orders: user._count.transactions,
      role: user.role,
      isSuspended: user.isSuspended,
      status: user.isSuspended ? 'Suspended' : 'Active',
      statusClass: user.isSuspended ? 'pill p-f' : 'pill p-s',
    }))
}

// ── Orders ────────────────────────────────────────────────────────

export interface OrderRow {
  id: string
  ref: string
  customer: string
  phone: string
  plan: string
  amount: number
  provider: string
  when: string
  status: string
  statusClass: string
  /** True while the order still has to be looked at. */
  needsReview: boolean
}

/** The order list, with a status filter. */
export async function getOrderRows(
  filter = 'All'
): Promise<OrderRow[]> {
  const transactions = await prisma.transaction.findMany({
    where: { typeKey: 'd' },
    include: {
      user: { select: { fullName: true, phone: true } },
      provider: { select: { name: true } },
    },
    orderBy: { date: 'desc' },
    take: 200,
  })

  const statusMap: Record<string, { label: string; className: string }> = {
    Successful: { label: 'Delivered', className: 'pill p-s' },
    Pending: { label: 'Needs review', className: 'pill p-p' },
    Failed: { label: 'Failed, refunded', className: 'pill p-f' },
  }

  return transactions
    .filter((transaction) => {
      if (filter === 'All') return true
      if (filter === 'Needs review') return transaction.status === 'Pending'
      if (filter === 'Failed') return transaction.status === 'Failed'
      if (filter === 'Delivered') return transaction.status === 'Successful'
      return true
    })
    .map((transaction) => {
      const status = statusMap[transaction.status] ?? {
        label: transaction.status,
        className: 'pill p-n',
      }
      return {
        id: transaction.id,
        ref: transaction.ref,
        customer: transaction.user.fullName,
        phone: transaction.user.phone,
        plan: transaction.subtitle,
        amount: Math.abs(transaction.amount),
        provider: transaction.provider?.name ?? 'None answered',
        when: transaction.date.toISOString(),
        status: status.label,
        statusClass: status.className,
        needsReview: transaction.status === 'Pending',
      }
    })
}

// ── Auto-Buy ──────────────────────────────────────────────────────

export interface AutoBuyRow {
  id: string
  customer: string
  phone: string
  plan: string
  amount: number
  /** The schedule in plain words, e.g. "Every day at 8:00 AM". */
  frequency: string
  /** When the next purchase happens, already formatted for the panel. */
  nextRun: string
  isActive: boolean
  status: string
  statusClass: string
  failures: number
}

/**
 * The Auto-Buy rules customers created, with the customer they belong to.
 */
export async function getAutoBuyRows(): Promise<AutoBuyRow[]> {
  const schedules = await prisma.autoBuySchedule.findMany({
    include: { user: { select: { fullName: true, phone: true } } },
    orderBy: { nextRunAt: 'asc' },
    take: 200,
  })

  return schedules.map((schedule) => {
    const presented = presentSchedule(schedule)
    const isActive = schedule.status === 'Active'
    return {
      id: schedule.id,
      customer: schedule.user.fullName,
      phone: schedule.user.phone,
      plan: `${schedule.network} ${schedule.planGb}`,
      amount: schedule.price,
      frequency: presented.summary,
      nextRun: isActive ? presented.nextRunLabel : 'Paused',
      isActive,
      status: isActive ? 'Active' : 'Paused',
      statusClass: isActive ? 'pill p-s' : 'pill p-p',
      failures: schedule.consecutiveFailures,
    }
  })
}

// ── Referrals ─────────────────────────────────────────────────────
export interface ReferralRow {
  id: string
  name: string
  friends: number
  earned: number
  isActive: boolean
  status: string
  statusClass: string
}

/** The top referrers and the commission that has been paid out. */
export async function getReferralRows(): Promise<ReferralRow[]> {
  const referrers = await prisma.referral.groupBy({
    by: ['referrerId'],
    _count: { _all: true },
    _sum: { earned: true },
  })

  const users = await prisma.user.findMany({
    where: { id: { in: referrers.map((row) => row.referrerId) } },
    select: { id: true, fullName: true, isSuspended: true },
  })
  const nameById = new Map(users.map((user) => [user.id, user.fullName]))
  const suspendedById = new Map(users.map((user) => [user.id, user.isSuspended]))

  return referrers
    .map((row) => {
      const suspended = suspendedById.get(row.referrerId) ?? false
      return {
        id: row.referrerId,
        name: nameById.get(row.referrerId) ?? 'Unknown',
        friends: row._count._all,
        earned: row._sum.earned ?? 0,
        isActive: !suspended,
        status: suspended ? 'Account suspended' : 'Account active',
        statusClass: suspended ? 'pill p-f' : 'pill p-s',
      }
    })
    .sort((a, b) => b.earned - a.earned)
}
