import { prisma } from '@/lib/prisma'
import {
  getSettings,
  settingFlag,
  settingNumber,
  type AdminSettings,
} from '@/lib/admin/settings'

export interface ReferralCredit {
  /** The referrer that earned the reward, when one was found. */
  referrerId: string | null
  /** The customer whose purchase triggered the reward. */
  friendId: string
  /** The reward that was credited, in Naira. */
  amount: number
  /** True when the purchase was the friend's first. */
  firstPurchase: boolean
  /** True when the reward was skipped (disabled / not referred / capped). */
  skipped: boolean
}

const skippedCredit: ReferralCredit = {
  referrerId: null,
  friendId: '',
  amount: 0,
  firstPurchase: false,
  skipped: true,
}

/**
 * Credits the reward a referred customer has earned for their referrer.
 *
 * The rules come from the admin settings (see `src/lib/admin/settings.ts`):
 *
 *   - `referral.enabled` turns the program off without a code change.
 *   - `referral.firstBonus` is paid once, when the friend makes their first
 *     purchase.
 *   - `referral.commissionPct` is the percentage of the profit that is paid
 *     on every later purchase.
 *   - `referral.monthlyCap` is the maximum paid to one referrer per month.
 *   - `referral.whoCanEarn` limits the program to agents when set so.
 *
 * The caller passes the purchase amount and, when it is known, the provider
 * cost so the commission can be computed on the profit rather than the sale
 * price.
 */
export async function creditReferralForPurchase(input: {
  buyerId: string
  /** Price charged for the purchase, in Naira (positive). */
  amount: number
  /** Provider cost for the purchase, in Naira. Profit = amount - cost. */
  cost?: number | null
}): Promise<ReferralCredit> {
  const settings: AdminSettings = await getSettings()
  if (!settingFlag(settings, 'referral.enabled')) {
    return { ...skippedCredit, friendId: input.buyerId }
  }

  const buyer = await prisma.user.findUnique({
    where: { id: input.buyerId },
    select: { referredBy: true },
  })
  const referrerCode = buyer?.referredBy
  if (!referrerCode) {
    return { ...skippedCredit, friendId: input.buyerId }
  }

  const referrer = await prisma.user.findUnique({
    where: { referralCode: referrerCode },
    select: { id: true, fullName: true, role: true },
  })
  if (!referrer) {
    return { ...skippedCredit, friendId: input.buyerId }
  }

  // The program is audience gated: agents only means only agents earn.
  if (settings['referral.whoCanEarn'] === 'Agents only' && referrer.role !== 'Agent') {
    return { ...skippedCredit, friendId: input.buyerId }
  }

  const existing = await prisma.referral.findFirst({
    where: { referrerId: referrer.id, friendId: input.buyerId },
  })

  const firstPurchase = !existing
  const profit = Math.max(0, input.amount - (input.cost ?? 0))
  const reward = firstPurchase
    ? Math.max(0, settingNumber(settings, 'referral.firstBonus'))
    : Math.max(0, Math.floor((profit * settingNumber(settings, 'referral.commissionPct')) / 100))

  // One payout per customer per month at most.
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthEarnings = await prisma.referral.aggregate({
    where: { referrerId: referrer.id, createdAt: { gte: monthStart } },
    _sum: { earned: true },
  })
  const paidThisMonth = monthEarnings._sum?.earned ?? 0
  const cap = settingNumber(settings, 'referral.monthlyCap')
  const payout = Math.min(reward, Math.max(0, cap - paidThisMonth))
  if (payout <= 0) {
    return { referrerId: referrer.id, friendId: input.buyerId, amount: 0, firstPurchase, skipped: true }
  }

  if (firstPurchase) {
    await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        friendId: input.buyerId,
        friendName: referrer.fullName,
        friendStatus: 'Active',
        earned: payout,
        createdAt: new Date(),
      },
    })
  } else if (existing) {
    await prisma.referral.update({
      where: { id: existing.id },
      data: { earned: { increment: payout }, friendStatus: 'Active' },
    })
  }

  await prisma.user.update({
    where: { id: referrer.id },
    data: { referralBonus: { increment: payout } },
  })

  return { referrerId: referrer.id, friendId: input.buyerId, amount: payout, firstPurchase, skipped: false }
}
