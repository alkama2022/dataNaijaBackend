'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/auth'
import {
  endAdminSession,
  requireAdmin,
  startAdminSession,
} from '@/lib/admin/session'
import { saveSettings } from '@/lib/admin/settings'
import { naira } from '@/lib/admin/analytics'
import {
  markOrderDelivered as markOrderDeliveredAction,
  refundHeldOrder,
  OrderError,
} from '@/lib/admin/orders'

/**
 * The admin panel's writes.
 *
 * Every action is a server action, so the pages stay simple: a plain
 * `<form action={...}>` and the page re-renders with the new data.
 *
 * After a write the action redirects back with a `?msg=` (or `?error=`)
 * query parameter. That keeps the result visible without needing a
 * client-side state library.
 */

/** Goes back to `path` with a success message. */
function flash(path: string, message: string): never {
  redirect(`${path}?msg=${encodeURIComponent(message)}`)
}

/** Goes back to `path` with an error message. */
function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`)
}

/** Reads a trimmed string field. */
function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

/** The message of an expected failure, or a generic one. */
function messageOf(error: unknown): string {
  if (error instanceof OrderError) return error.message
  return 'Something went wrong. Please try again.'
}

// ── Session ───────────────────────────────────────────────────────

export async function signInAction(formData: FormData) {
  const phone = text(formData, 'phone')
  const password = String(formData.get('password') ?? '')
  const next = text(formData, 'next') || '/admin'

  if (!/^0[789][01]\d{8}$/.test(phone) || password.length < 6) {
    fail('/admin/signin', 'Invalid credentials')
  }

  const user = await prisma.user.findUnique({ where: { phone } })
  // The same message for an unknown number and a wrong password, so the
  // form does not confirm which accounts exist.
  if (!user || !user.isAdmin) {
    fail('/admin/signin', 'Invalid credentials')
  }
  if (user.isSuspended) {
    fail('/admin/signin', 'This account is suspended.')
  }

  const matches = await bcrypt.compare(password, user.passwordHash)
  if (!matches) {
    fail('/admin/signin', 'Invalid credentials')
  }

  const token = await signToken({
    userId: user.id,
    phone: user.phone,
  } as { userId: string; phone: string })
  startAdminSession(token)
  redirect(next === '/admin' || next.startsWith('/admin/') ? next : '/admin')
}

export async function signOutAction() {
  endAdminSession()
  redirect('/admin/signin')
}

// ── Prices ────────────────────────────────────────────────────────

export async function savePlanPrices(formData: FormData) {
  await requireAdmin()
  const priceUpdates: Array<{ planId: string; price: number }> = []
  const costUpdates: Array<{
    planId: string
    providerId: string
    cost: number | null
  }> = []

  for (const [key, value] of Array.from(formData.entries())) {
    if (key.startsWith('price-')) {
      const planId = key.slice('price-'.length)
      const price = Number(String(value))
      if (!planId || !Number.isSafeInteger(price) || price <= 0) {
        fail('/admin/prices', 'Enter a valid sell price.')
      }
      priceUpdates.push({ planId, price })
      continue
    }

    if (key.startsWith('cost:')) {
      const [, providerId, planId] = key.split(':')
      const rawCost = String(value).trim()
      const cost = rawCost === '' ? null : Number(rawCost)
      if (
        !providerId ||
        !planId ||
        (cost !== null && (!Number.isSafeInteger(cost) || cost < 0))
      ) {
        fail('/admin/prices', 'Enter a valid provider cost or leave it blank.')
      }
      costUpdates.push({ providerId, planId, cost })
    }
  }

  if (priceUpdates.length === 0 && costUpdates.length === 0) {
    fail('/admin/prices', 'Nothing to save.')
  }

  await prisma.$transaction(async (tx) => {
    for (const update of priceUpdates) {
      await tx.dataPlan.update({
        where: { id: update.planId },
        data: { price: update.price },
      })
    }

    for (const update of costUpdates) {
      if (update.cost === null) {
        await tx.providerPlanCost.deleteMany({
          where: {
            providerId: update.providerId,
            planId: update.planId,
          },
        })
      } else {
        await tx.providerPlanCost.upsert({
          where: {
            providerId_planId: {
              providerId: update.providerId,
              planId: update.planId,
            },
          },
          create: {
            providerId: update.providerId,
            planId: update.planId,
            cost: update.cost,
          },
          update: { cost: update.cost },
        })
      }
    }
  })
  revalidatePath('/admin/prices')
  revalidatePath('/admin/providers')
  flash('/admin/prices', 'Prices and provider costs saved.')
}

export async function togglePlanActive(formData: FormData) {
  await requireAdmin()
  const planId = text(formData, 'planId')
  const plan = await prisma.dataPlan.findUnique({ where: { id: planId } })
  if (!plan) fail('/admin/prices', 'Plan not found.')

  await prisma.dataPlan.update({
    where: { id: planId },
    data: { isActive: !plan.isActive },
  })
  revalidatePath('/admin/prices')
  flash('/admin/prices', `${plan.id} switched ${plan.isActive ? 'off' : 'on'}.`)
}

export async function addPlan(formData: FormData) {
  await requireAdmin()
  const networkName = text(formData, 'network')
  const type = text(formData, 'type')
  const size = text(formData, 'size')
  const sellPrice = Number(text(formData, 'sellPrice'))

  if (!networkName || !type || !size) {
    fail('/admin/prices', 'Network, data type and plan size are required.')
  }
  if (!Number.isSafeInteger(sellPrice) || sellPrice <= 0) {
    fail('/admin/prices', 'Enter a valid sell price.')
  }

  const network = await prisma.network.findFirst({ where: { name: networkName } })
  if (!network) {
    fail('/admin/prices', 'That network does not exist.')
  }

  // The plan id is derived from its details so the seed and the admin
  // panel produce the same rows.
  const id = `${network.name}-${type}-${size}`
  const existing = await prisma.dataPlan.findUnique({ where: { id } })
  if (existing) {
    fail('/admin/prices', 'That plan already exists.')
  }

  await prisma.dataPlan.create({
    data: {
      id,
      networkId: network.id,
      type,
      gb: size,
      days: '30 Days',
      price: Math.round(sellPrice),
      isActive: true,
    },
  })

  revalidatePath('/admin/prices')
  flash('/admin/prices', 'Plan added. Press Save prices to publish it.')
}

// ── Providers ─────────────────────────────────────────────────────

export async function toggleProviderActive(formData: FormData) {
  await requireAdmin()
  const providerId = text(formData, 'providerId')
  const provider = await prisma.provider.findUnique({ where: { id: providerId } })
  if (!provider) {
    fail('/admin/providers', 'Provider not found.')
  }

  await prisma.provider.update({
    where: { id: providerId },
    data: { isActive: !provider.isActive },
  })
  revalidatePath('/admin/providers')
  flash(
    '/admin/providers',
    `${provider.name} switched ${provider.isActive ? 'off' : 'on'}.`
  )
}

export async function toggleProviderOutage(formData: FormData) {
  await requireAdmin()
  const providerId = text(formData, 'providerId')
  const provider = await prisma.provider.findUnique({ where: { id: providerId } })
  if (!provider) {
    fail('/admin/providers', 'Provider not found.')
  }

  await prisma.provider.update({
    where: { id: providerId },
    data: { isDown: !provider.isDown },
  })
  revalidatePath('/admin/providers')
  flash(
    '/admin/providers',
    provider.isDown
      ? `${provider.name} is back online.`
      : `${provider.name} marked down in routing settings.`
  )
}

export async function recordProviderBalance(formData: FormData) {
  await requireAdmin()
  const providerId = text(formData, 'providerId')
  const amount = Number(text(formData, 'amount'))

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    fail('/admin/providers', 'Enter a valid amount.')
  }

  const provider = await prisma.provider.findUnique({ where: { id: providerId } })
  if (!provider) {
    fail('/admin/providers', 'Provider not found.')
  }

  // The money is moved in the provider's own dashboard, so this records
  // the balance it reports rather than adding to it.
  await prisma.provider.update({
    where: { id: providerId },
    data: { walletBalance: Math.round(amount) },
  })
  revalidatePath('/admin/providers')
  flash(
    '/admin/providers',
    `${provider.name}'s wallet balance recorded as ${naira(amount)}.`
  )
}

// ── Users ─────────────────────────────────────────────────────────

export async function toggleUserSuspension(formData: FormData) {
  await requireAdmin()
  const userId = text(formData, 'userId')
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    fail('/admin/users', 'User not found.')
  }
  if (user.isAdmin) {
    fail('/admin/users', 'Admins cannot be suspended here.')
  }

  await prisma.user.update({
    where: { id: userId },
    data: { isSuspended: !user.isSuspended },
  })
  revalidatePath('/admin/users')
  flash(
    '/admin/users',
    user.isSuspended
      ? `${user.fullName} reactivated.`
      : `${user.fullName} suspended.`
  )
}

// ── Orders ────────────────────────────────────────────────────────

export async function markOrderDelivered(formData: FormData) {
  await requireAdmin()
  const transactionId = text(formData, 'transactionId')

  try {
    const ref = await markOrderDeliveredAction(transactionId)
    revalidatePath('/admin/orders')
    flash('/admin/orders', `${ref} marked as delivered.`)
  } catch (error) {
    fail('/admin/orders', messageOf(error))
  }
}

export async function refundOrder(formData: FormData) {
  await requireAdmin()
  const transactionId = text(formData, 'transactionId')

  try {
    const refund = await refundHeldOrder(transactionId)
    revalidatePath('/admin/orders')
    flash(
      '/admin/orders',
      `${naira(refund.amount)} refunded to ${refund.customer}'s wallet.`
    )
  } catch (error) {
    fail('/admin/orders', messageOf(error))
  }
}

// ── Auto-Buy ──────────────────────────────────────────────────────

export async function toggleAutoBuy(formData: FormData) {
  await requireAdmin()
  const scheduleId = text(formData, 'scheduleId')
  const status = text(formData, 'status')
  if (status !== 'Active' && status !== 'Paused') {
    fail('/admin/auto-buy', 'Invalid status.')
  }

  const schedule = await prisma.autoBuySchedule.findUnique({
    where: { id: scheduleId },
  })
  if (!schedule) {
    fail('/admin/auto-buy', 'Schedule not found.')
  }

  await prisma.autoBuySchedule.update({
    where: { id: scheduleId },
    data: { status, pendingSlot: null },
  })
  revalidatePath('/admin/auto-buy')
  flash(
    '/admin/auto-buy',
    status === 'Active'
      ? `${schedule.network} ${schedule.planGb} is active again.`
      : `${schedule.network} ${schedule.planGb} paused.`
  )
}

// ── Referrals ─────────────────────────────────────────────────────

export async function saveReferralSettings(formData: FormData) {
  await requireAdmin()
  const firstBonus = text(formData, 'firstBonus')
  const commissionPct = text(formData, 'commissionPct')
  const monthlyCap = text(formData, 'monthlyCap')
  const minToWithdraw = text(formData, 'minToWithdraw')
  const lifetime = text(formData, 'lifetime')
  const whoCanEarn = text(formData, 'whoCanEarn')

  for (const value of [firstBonus, commissionPct, monthlyCap, minToWithdraw]) {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      fail('/admin/referrals', 'Enter valid whole-number referral values.')
    }
  }
  if (Number(commissionPct) > 100) {
    fail('/admin/referrals', 'Commission cannot exceed 100%.')
  }
  if (!['Lifetime', '12 months', '6 months'].includes(lifetime)) {
    fail('/admin/referrals', 'Choose a valid referral duration.')
  }
  if (!['Everyone', 'Agents only'].includes(whoCanEarn)) {
    fail('/admin/referrals', 'Choose a valid referral audience.')
  }

  await saveSettings({
    'referral.enabled': formData.get('enabled') === 'on' ? '1' : '0',
    'referral.firstBonus': firstBonus,
    'referral.commissionPct': commissionPct,
    'referral.monthlyCap': monthlyCap,
    'referral.minToWithdraw': minToWithdraw,
    'referral.lifetime': lifetime,
    'referral.whoCanEarn': whoCanEarn,
  })
  revalidatePath('/admin/referrals')
  flash(
    '/admin/referrals',
    'Referral settings saved. The current purchase flow does not yet apply these rewards.'
  )
}

// ── Routing ───────────────────────────────────────────────────────

export async function saveRoutingSettings(formData: FormData) {
  await requireAdmin()
  const weights = [
    text(formData, 'weightPrice'),
    text(formData, 'weightReliability'),
    text(formData, 'weightFault'),
    text(formData, 'weightAvailability'),
  ]
  if (
    weights.some(
      (value) => !/^\d{1,3}$/.test(value) || Number(value) > 100
    )
  ) {
    fail('/admin/providers', 'Routing weights must be between 0 and 100.')
  }

  const requestedMode = text(formData, 'mode')
  if (requestedMode !== 'smart' && requestedMode !== 'cheap') {
    fail('/admin/providers', 'Choose a valid routing mode.')
  }

  await saveSettings({
    'routing.mode': requestedMode,
    'routing.weight.price': weights[0],
    'routing.weight.reliability': weights[1],
    'routing.weight.fault': weights[2],
    'routing.weight.availability': weights[3],
  })
  revalidatePath('/admin/providers')
  flash(
    '/admin/providers',
    'Routing rules saved. Purchases are not yet connected to provider routing.'
  )
}
