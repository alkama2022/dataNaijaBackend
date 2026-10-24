// Tests for the admin panel.
//
// The routing maths and the settings are pure, so they are tested
// directly. The order operations and the overview run against the real
// database, because they move money and have to be right.

import { prisma } from '@/lib/prisma'
import {
  rankProviders,
  planMargin,
  type ProviderCandidate,
} from '@/lib/admin/routing'
import {
  getSettings,
  saveSettings,
  settingFlag,
  settingNumber,
} from '@/lib/admin/settings'
import {
  businessDayStart,
  getOrderRows,
  getOverview,
  getPlanMargins,
  getUserRows,
  naira,
} from '@/lib/admin/analytics'
import {
  markOrderDelivered,
  refundHeldOrder,
  OrderError,
} from '@/lib/admin/orders'
import { gatewayFee, PAYMENT_GATEWAYS } from '@/lib/admin/payment-gateways'
import { createUser, freshDatabase } from './helpers/db'

/** A provider that can take an order. */
function candidate(overrides: Partial<ProviderCandidate> = {}): ProviderCandidate {
  return {
    providerId: 'p1',
    name: 'Provider',
    cost: 200,
    isActive: true,
    isDown: false,
    walletBalance: 50_000,
    reliability: 98,
    faultRate: 1,
    availability: 99,
    ...overrides,
  }
}

const WEIGHTS = {
  price: 40,
  reliability: 30,
  fault: 20,
  availability: 10,
}

beforeEach(async () => {
  await freshDatabase()
})

describe('provider routing', () => {
  test('skips providers that are off, down or cannot afford the order', () => {
    const ranked = rankProviders(
      [
        candidate({ providerId: 'off', name: 'Off', isActive: false }),
        candidate({ providerId: 'down', name: 'Down', isDown: true }),
        candidate({ providerId: 'broke', name: 'Broke', walletBalance: 10 }),
        candidate({ providerId: 'ok', name: 'OK' }),
      ],
      WEIGHTS
    )

    expect(ranked.map((provider) => provider.name)).toEqual(['OK'])
  })

  test('skips providers that do not sell the plan', () => {
    const ranked = rankProviders(
      [
        candidate({ providerId: 'none', name: 'None', cost: null }),
        candidate({ providerId: 'ok', name: 'OK' }),
      ],
      WEIGHTS
    )

    expect(ranked.map((provider) => provider.name)).toEqual(['OK'])
  })

  test('the cheapest mode picks the cheapest provider', () => {
    const ranked = rankProviders(
      [
        candidate({ providerId: 'mid', name: 'Mid', cost: 250 }),
        candidate({ providerId: 'cheap', name: 'Cheap', cost: 200 }),
      ],
      WEIGHTS,
      'cheap'
    )

    expect(ranked[0].name).toBe('Cheap')
  })

  test('the cheapest mode breaks ties on reliability', () => {
    const ranked = rankProviders(
      [
        candidate({ providerId: 'flaky', name: 'Flaky', cost: 200, reliability: 80 }),
        candidate({ providerId: 'steady', name: 'Steady', cost: 200, reliability: 99 }),
      ],
      WEIGHTS,
      'cheap'
    )

    expect(ranked[0].name).toBe('Steady')
  })

  test('the smart mode prefers the better provider over the cheaper one', () => {
    const ranked = rankProviders(
      [
        candidate({ providerId: 'cheap', name: 'Cheap', cost: 180, reliability: 70 }),
        candidate({ providerId: 'good', name: 'Good', cost: 220, reliability: 99 }),
      ],
      WEIGHTS
    )

    expect(ranked[0].name).toBe('Good')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  test('the score stays between 0 and 1', () => {
    const ranked = rankProviders(
      [
        candidate({ providerId: 'perfect', name: 'Perfect', cost: 200, reliability: 100, faultRate: 0, availability: 100 }),
        candidate({ providerId: 'worst', name: 'Worst', cost: 400, reliability: 90, faultRate: 5, availability: 90 }),
      ],
      WEIGHTS
    )

    for (const provider of ranked) {
      expect(provider.score).toBeGreaterThanOrEqual(0)
      expect(provider.score).toBeLessThanOrEqual(1)
    }
  })

  test('the margin is the sell price minus the best cost', () => {
    const ranked = rankProviders([candidate({ cost: 215 })], WEIGHTS)
    expect(planMargin(300, ranked)).toBe(85)
    expect(planMargin(300, [])).toBeNull()
  })
})

describe('admin settings', () => {
  test('returns the defaults on a fresh database', async () => {
    const settings = await getSettings()

    expect(settings['referral.firstBonus']).toBe('100')
    expect(settings['referral.commissionPct']).toBe('20')
    expect(settings['routing.mode']).toBe('smart')
    expect(settingFlag(settings, 'referral.enabled')).toBe(true)
    expect(settingNumber(settings, 'routing.weight.price')).toBe(40)
  })

  test('saves and reads the values back', async () => {
    await saveSettings({
      'referral.firstBonus': '250',
      'referral.commissionPct': '15',
    })

    const settings = await getSettings()
    expect(settings['referral.firstBonus']).toBe('250')
    expect(settings['referral.commissionPct']).toBe('15')
    // The settings that were not saved keep their defaults.
    expect(settings['referral.monthlyCap']).toBe('5000')
  })
})

describe('the business day', () => {
  test('starts at midnight in Lagos', () => {
    // 23:30 UTC is already the next day in Lagos (UTC+1).
    const start = businessDayStart(new Date('2026-10-20T23:30:00.000Z'))
    expect(start.toISOString()).toBe('2026-10-20T23:00:00.000Z')
  })
})

describe('the overview', () => {
  test('counts today sales, profit and the success rate', async () => {
    const user = await createUser({ balance: 5000 })
    const plan = await prisma.dataPlan.findFirst()
    const provider = await prisma.provider.create({
      data: { name: 'Toppa', walletBalance: 50_000 },
    })

    await prisma.providerPlanCost.create({
      data: { providerId: provider.id, planId: plan!.id, cost: 200 },
    })

    const now = new Date('2026-10-20T12:00:00.000Z')
    const today = new Date('2026-10-20T09:00:00.000Z')

    await prisma.transaction.create({
      data: {
        userId: user.id,
        title: 'Data Purchase',
        subtitle: 'MTN 1GB',
        amount: -300,
        status: 'Successful',
        phone: user.phone,
        ref: 'DN-OK-1',
        typeKey: 'd',
        date: today,
        planId: plan!.id,
        providerId: provider.id,
      },
    })
    await prisma.transaction.create({
      data: {
        userId: user.id,
        title: 'Data Purchase',
        subtitle: 'MTN 1GB',
        amount: -300,
        status: 'Failed',
        phone: user.phone,
        ref: 'DN-BAD-1',
        typeKey: 'd',
        date: today,
        planId: plan!.id,
        providerId: provider.id,
      },
    })

    const overview = await getOverview(now)

    // Only delivered orders count as sales.
    expect(overview.salesToday).toBe(300)
    expect(overview.ordersToday).toBe(2)
    // 300 sold, 200 paid to the provider.
    expect(overview.profitToday).toBe(100)
    // One of the two orders in the last 24 hours succeeded.
    expect(overview.successRate).toBe(50)
    expect(overview.week).toHaveLength(7)
  })

  test('the profit is unknown when a delivered order has no provider cost', async () => {
    const user = await createUser({ balance: 5000 })
    const plan = await prisma.dataPlan.findFirst()

    // No provider cost is recorded for this order.
    await prisma.transaction.create({
      data: {
        userId: user.id,
        title: 'Data Purchase',
        subtitle: 'MTN 1GB',
        amount: -300,
        status: 'Successful',
        phone: user.phone,
        ref: 'DN-NO-COST-1',
        typeKey: 'd',
        planId: plan!.id,
      },
    })

    const overview = await getOverview()

    // The sales are known, but the profit would be a guess, so it is not
    // shown at all.
    expect(overview.salesToday).toBe(300)
    expect(overview.profitToday).toBeNull()
    expect(overview.profitOrdersMissingCost).toBe(1)
  })

  test('counts the orders that need attention', async () => {
    const user = await createUser()
    await prisma.transaction.create({
      data: {
        userId: user.id,
        title: 'Data Purchase',
        subtitle: 'MTN 1GB',
        amount: -300,
        status: 'Pending',
        phone: user.phone,
        ref: 'DN-HELD-1',
        typeKey: 'd',
      },
    })
    await prisma.provider.create({
      data: { name: 'Low', walletBalance: 100 },
    })

    const overview = await getOverview()
    expect(overview.needsAttention.ordersHeld).toBe(1)
    expect(overview.needsAttention.providersLow).toBeGreaterThan(0)
  })
})

describe('the plan margins', () => {
  test('uses the cheapest provider cost', async () => {
    const plan = await prisma.dataPlan.findFirst()
    const toppa = await prisma.provider.create({
      data: { name: 'Toppa', walletBalance: 50_000 },
    })
    const other = await prisma.provider.create({
      data: { name: 'Other', walletBalance: 50_000 },
    })

    await prisma.providerPlanCost.create({
      data: { providerId: toppa.id, planId: plan!.id, cost: 215 },
    })
    await prisma.providerPlanCost.create({
      data: { providerId: other.id, planId: plan!.id, cost: 245 },
    })

    const margins = await getPlanMargins()
    const row = margins.find((entry) => entry.planId === plan!.id)!

    expect(row.bestCost).toBe(215)
    expect(row.margin).toBe(row.sellPrice - 215)
    expect(row.costs.map((cost) => cost.cost)).toEqual([215, 245])
  })
})

describe('the user list', () => {
  test('searches by name and phone, and filters by status', async () => {
    await createUser({
      id: 'u1',
      fullName: 'Chinedu Okafor',
      phone: '08011111111',
    })
    await createUser({
      id: 'u2',
      fullName: 'Amina Bello',
      phone: '08022222222',
      isSuspended: true,
    })

    expect((await getUserRows('chinedu')).map((row) => row.id)).toEqual(['u1'])
    expect((await getUserRows('08022222')).map((row) => row.id)).toEqual(['u2'])
    expect((await getUserRows('', 'Suspended')).map((row) => row.id)).toEqual(['u2'])
    expect((await getUserRows('', 'Active')).map((row) => row.id)).toEqual(['u1'])
  })
})

describe('the order list', () => {
  test('filters by status', async () => {
    const user = await createUser()
    await prisma.transaction.create({
      data: {
        userId: user.id,
        title: 'Data Purchase',
        subtitle: 'MTN 1GB',
        amount: -300,
        status: 'Pending',
        phone: user.phone,
        ref: 'DN-HELD-2',
        typeKey: 'd',
      },
    })
    await prisma.transaction.create({
      data: {
        userId: user.id,
        title: 'Data Purchase',
        subtitle: 'MTN 1GB',
        amount: -300,
        status: 'Successful',
        phone: user.phone,
        ref: 'DN-OK-2',
        typeKey: 'd',
      },
    })

    expect((await getOrderRows('Needs review')).map((row) => row.ref)).toEqual([
      'DN-HELD-2',
    ])
    expect((await getOrderRows('Delivered')).map((row) => row.ref)).toEqual([
      'DN-OK-2',
    ])
    expect((await getOrderRows()).length).toBe(2)
  })
})

describe('the order operations', () => {
  test('marks a held order as delivered', async () => {
    const user = await createUser()
    const transaction = await prisma.transaction.create({
      data: {
        userId: user.id,
        title: 'Data Purchase',
        subtitle: 'MTN 1GB',
        amount: -300,
        status: 'Pending',
        phone: user.phone,
        ref: 'DN-HELD-3',
        typeKey: 'd',
      },
    })

    const ref = await markOrderDelivered(transaction.id)
    expect(ref).toBe('DN-HELD-3')

    const reloaded = await prisma.transaction.findUnique({
      where: { id: transaction.id },
    })
    expect(reloaded?.status).toBe('Successful')
  })

  test('refunds a held order and credits the wallet once', async () => {
    const user = await createUser({ balance: 100 })
    const transaction = await prisma.transaction.create({
      data: {
        userId: user.id,
        title: 'Data Purchase',
        subtitle: 'MTN 1GB',
        amount: -300,
        status: 'Pending',
        phone: user.phone,
        ref: 'DN-HELD-4',
        typeKey: 'd',
      },
    })

    const refund = await refundHeldOrder(transaction.id)
    expect(refund.amount).toBe(300)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(400)

    // A second refund must not pay the customer twice.
    await expect(refundHeldOrder(transaction.id)).rejects.toThrow(OrderError)
    const afterSecond = await prisma.user.findUnique({ where: { id: user.id } })
    expect(afterSecond?.balance).toBe(400)
  })

  test('refuses to refund an order that was already delivered', async () => {
    const user = await createUser({ balance: 100 })
    const transaction = await prisma.transaction.create({
      data: {
        userId: user.id,
        title: 'Data Purchase',
        subtitle: 'MTN 1GB',
        amount: -300,
        status: 'Successful',
        phone: user.phone,
        ref: 'DN-OK-3',
        typeKey: 'd',
      },
    })

    await expect(refundHeldOrder(transaction.id)).rejects.toThrow(OrderError)
    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(100)
  })
})

describe('the gateway fees', () => {
  test('applies the rate and the cap', () => {
    const paystack = PAYMENT_GATEWAYS.find(
      (gateway) => gateway.name === 'Paystack'
    )!
    // 1% of 1,000 is 10, which is under the 300 cap.
    expect(gatewayFee(paystack, 1000, false)).toBeCloseTo(10)
    // 1% of 100,000 is 1,000, which is over the cap.
    expect(gatewayFee(paystack, 100_000, false)).toBeCloseTo(300)
  })

  test('adds the VAT when it is switched on', () => {
    const squad = PAYMENT_GATEWAYS.find(
      (gateway) => gateway.name === 'Squad (GTCO)'
    )!
    expect(gatewayFee(squad, 10_000, false)).toBeCloseTo(10)
    expect(gatewayFee(squad, 10_000, true)).toBeCloseTo(10.75)
  })

  test('formats the amounts the way the panel shows them', () => {
    expect(naira(1500)).toBe('₦1,500')
  })
})
