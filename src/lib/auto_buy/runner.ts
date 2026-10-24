/**
 * Auto-Buy scheduler.
 *
 * `runDueAutoBuySchedules()` is the single entry point used by the cron
 * route. It finds every rule that is due, executes it and records the
 * result.
 *
 * Safety rules implemented here (in order):
 *  1. **Claim** — a compare-and-swap on `nextRunAt` plus a short lock makes
 *     sure two workers can never execute the same slot.
 *  2. **Idempotency** — one execution row per (schedule, slot). A slot that
 *     already succeeded is never charged again.
 *  3. **Price / availability re-check** — the bundle is looked up again
 *     right before the purchase, never trusting the price stored on the rule.
 *  4. **Balance check** — the purchase is not attempted at all when the
 *     wallet cannot cover it, so the balance can never go negative.
 *  5. **Provider confirmation** — a purchase is only reported as successful
 *     after the provider confirmed the delivery *and* the wallet debit and
 *     the transaction record were committed together.
 */

import { prisma } from '@/lib/prisma'
import { computeNextRun, type ScheduleSpec } from './schedule'
import {
  buildTransactionRef,
  defaultDataProvider,
  type DataProvider,
} from './provider'
import type { FrequencyUnit } from './frequency'

/** Slots that are older than this are skipped instead of executed. */
const DEFAULT_GRACE_MINUTES = 30
/** How long a worker may hold a schedule before another one may take it. */
const LOCK_MINUTES = 5
/** Back-off (in minutes) for transient provider errors. */
const RETRY_DELAYS_MINUTES = [15, 30, 60]
/** Back-off (in minutes) when the wallet simply has no money. */
const INSUFFICIENT_FUNDS_RETRY_MINUTES = 360

export type FailureKind = 'provider' | 'insufficient-funds' | 'unavailable' | 'internal'

export interface SlotOutcome {
  outcome: 'successful' | 'failed' | 'skipped'
  reason?: string
  error?: string
}

export interface RunOptions {
  /** Override the provider (used by the tests). */
  provider?: DataProvider
  /** How old a slot may be before it is skipped instead of executed. */
  graceMinutes?: number
  /** "Now" — injectable for deterministic tests. */
  now?: Date
  /** Maximum number of rules processed in one run. */
  batchSize?: number
}

export interface RunSummary {
  processed: number
  successful: number
  failed: number
  skipped: number
  details: Array<{
    scheduleId: string
    slot: string
    outcome: SlotOutcome['outcome']
    reason?: string
    error?: string
  }>
}

/** Thrown when the wallet cannot cover the bundle. */
class InsufficientFundsError extends Error {}

/** True for a Postgres unique-constraint violation (Prisma error P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  )
}

/** Back-off before the next attempt of a failed slot. */
function retryDelayMinutes(kind: FailureKind, attempt: number): number {
  if (kind === 'insufficient-funds') return INSUFFICIENT_FUNDS_RETRY_MINUTES
  const index = Math.min(Math.max(attempt, 1), RETRY_DELAYS_MINUTES.length) - 1
  return RETRY_DELAYS_MINUTES[index]
}

/**
 * Executes every Auto-Buy rule that is due at [options.now].
 */
export async function runDueAutoBuySchedules(
  options: RunOptions = {}
): Promise<RunSummary> {
  const provider = options.provider ?? defaultDataProvider
  const now = options.now ?? new Date()
  const graceMs = (options.graceMinutes ?? DEFAULT_GRACE_MINUTES) * 60_000
  const batchSize = options.batchSize ?? 100
  const lockMs = LOCK_MINUTES * 60_000

  const summary: RunSummary = {
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    details: [],
  }

  const due = await prisma.autoBuySchedule.findMany({
    where: {
      status: 'Active',
      nextRunAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    orderBy: { nextRunAt: 'asc' },
    take: batchSize,
  })

  for (const schedule of due) {
    // ── 1. Claim the rule ───────────────────────────────────────────
    // The compare-and-swap means only the worker that observed this exact
    // `nextRunAt` may execute it. Everyone else moves on.
    const claimed = await prisma.autoBuySchedule.updateMany({
      where: {
        id: schedule.id,
        status: 'Active',
        nextRunAt: schedule.nextRunAt,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: { lockedUntil: new Date(now.getTime() + lockMs) },
    })
    if (claimed.count === 0) continue

    const slot = schedule.pendingSlot ?? schedule.nextRunAt
    const outcome = await executeSlot({
      schedule,
      slot,
      now,
      provider,
      graceMs,
    })

    summary.processed += 1
    summary[outcome.outcome] += 1
    summary.details.push({
      scheduleId: schedule.id,
      slot: slot.toISOString(),
      outcome: outcome.outcome,
      reason: outcome.reason,
      error: outcome.error,
    })
  }

  return summary
}

interface ExecuteArgs {
  schedule: {
    id: string
    userId: string
    network: string
    planType: string
    planGb: string
    planDays: string
    planId: string | null
    price: number
    phone: string
    frequency: string
    interval: number
    unit: string
    daysOfWeek: number[]
    timeOfDay: string
    timezone: string
    anchorAt: Date
    consecutiveFailures: number
    maxRetries: number
  }
  slot: Date
  now: Date
  provider: DataProvider
  graceMs: number
}

async function executeSlot(args: ExecuteArgs): Promise<SlotOutcome> {
  const { schedule, slot, now, provider, graceMs } = args

  const spec: ScheduleSpec = {
    frequency: schedule.frequency,
    interval: schedule.interval,
    unit: schedule.unit as FrequencyUnit,
    daysOfWeek: schedule.daysOfWeek,
    timeOfDay: schedule.timeOfDay,
    timezone: schedule.timezone,
    anchorAt: schedule.anchorAt,
  }
  const nextSlot = computeNextRun(spec, slot)

  // ── 2. Idempotency ───────────────────────────────────────────────
  const existing = await prisma.autoBuyExecution.findUnique({
    where: {
      scheduleId_scheduledFor: {
        scheduleId: schedule.id,
        scheduledFor: slot,
      },
    },
  })

  if (existing?.status === 'Successful') {
    await advance(schedule, slot, nextSlot, now)
    return { outcome: 'skipped', reason: 'already-completed' }
  }

  if (
    existing &&
    existing.status === 'Failed' &&
    existing.attempt >= schedule.maxRetries
  ) {
    await advance(schedule, slot, nextSlot, now)
    return { outcome: 'skipped', reason: 'retries-exhausted' }
  }

  // ── 3. Missed slot → skip, never surprise-charge ─────────────────
  if (now.getTime() - slot.getTime() > graceMs) {
    await prisma.autoBuyExecution.upsert({
      where: {
        scheduleId_scheduledFor: {
          scheduleId: schedule.id,
          scheduledFor: slot,
        },
      },
      create: {
        scheduleId: schedule.id,
        userId: schedule.userId,
        scheduledFor: slot,
        status: 'Skipped',
        error: 'Missed while the service was unavailable.',
      },
      update: {
        status: 'Skipped',
        error: 'Missed while the service was unavailable.',
      },
    })
    await advance(schedule, slot, nextSlot, now)
    return { outcome: 'skipped', reason: 'missed' }
  }

  // ── 4. Execution row ─────────────────────────────────────────────
  const execution = existing
    ? await prisma.autoBuyExecution.update({
        where: { id: existing.id },
        data: { status: 'Pending', attempt: existing.attempt + 1, error: null },
      })
    : await prisma.autoBuyExecution.create({
        data: {
          scheduleId: schedule.id,
          userId: schedule.userId,
          scheduledFor: slot,
          status: 'Pending',
          attempt: 1,
        },
      })

  const clientRef = buildTransactionRef(schedule.id, slot)

  // ── 5. Re-check price and availability ───────────────────────────
  const bundle = await provider.resolveBundle({
    network: schedule.network,
    planType: schedule.planType,
    planGb: schedule.planGb,
    planDays: schedule.planDays,
    planId: schedule.planId,
  })

  if (!bundle.available) {
    return fail({
      schedule,
      execution,
      slot,
      nextSlot,
      now,
      message: bundle.reason ?? 'This bundle is no longer available.',
      kind: 'unavailable',
    })
  }

  const price = bundle.price

  // ── 6. Balance check before the provider is contacted ────────────
  const user = await prisma.user.findUnique({
    where: { id: schedule.userId },
  })
  if (!user) {
    return fail({
      schedule,
      execution,
      slot,
      nextSlot,
      now,
      message: 'Your account could not be found.',
      kind: 'internal',
    })
  }

  if (user.balance < price) {
    return fail({
      schedule,
      execution,
      slot,
      nextSlot,
      now,
      message:
        'Not enough balance. Fund your wallet so the automatic purchase can continue.',
      kind: 'insufficient-funds',
    })
  }

  // ── 7. Provider delivery ─────────────────────────────────────────
  const purchase = await provider.purchase({
    network: schedule.network,
    planType: schedule.planType,
    planGb: schedule.planGb,
    planDays: schedule.planDays,
    planId: schedule.planId,
    phone: schedule.phone,
    amount: price,
    clientRef,
  })

  if (!purchase.success) {
    return fail({
      schedule,
      execution,
      slot,
      nextSlot,
      now,
      message: purchase.error ?? 'The purchase could not be completed.',
      kind: 'provider',
    })
  }

  // ── 8. Charge the wallet and record the transaction together ─────
  try {
    await prisma.$transaction(async (tx) => {
      // `balance: { gte: price }` makes the debit atomic: the wallet can
      // never go negative, even with two purchases racing.
      const deducted = await tx.user.updateMany({
        where: { id: schedule.userId, balance: { gte: price } },
        data: { balance: { decrement: price } },
      })
      if (deducted.count === 0) {
        throw new InsufficientFundsError()
      }

      await tx.transaction.create({
        data: {
          userId: schedule.userId,
          title: 'Auto-Buy Data Purchase',
          subtitle: `${schedule.network} ${schedule.planGb} - ${schedule.planDays}`,
          amount: -price,
          status: 'Successful',
          phone: schedule.phone,
          // Deterministic reference — a duplicate charge is rejected by the
          // unique constraint on `Transaction.ref`.
          ref: clientRef,
          typeKey: 'd',
          date: now,
          autoBuyScheduleId: schedule.id,
        },
      })

      await tx.autoBuyExecution.update({
        where: { id: execution.id },
        data: {
          status: 'Successful',
          amount: price,
          ref: clientRef,
          error: null,
        },
      })
    })
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      return fail({
        schedule,
        execution,
        slot,
        nextSlot,
        now,
        message:
          'Not enough balance. Fund your wallet so the automatic purchase can continue.',
        kind: 'insufficient-funds',
      })
    }

    if (isUniqueViolation(error)) {
      // The reference already exists: this slot was charged before.
      // Record it as done instead of charging again.
      await prisma.autoBuyExecution.update({
        where: { id: execution.id },
        data: { status: 'Successful', amount: price, ref: clientRef, error: null },
      })
      await advance(schedule, slot, nextSlot, now)
      return { outcome: 'skipped', reason: 'already-charged' }
    }

    return fail({
      schedule,
      execution,
      slot,
      nextSlot,
      now,
      message: 'The purchase could not be completed.',
      kind: 'internal',
    })
  }

  // ── 9. Success ───────────────────────────────────────────────────
  await prisma.autoBuySchedule.update({
    where: { id: schedule.id },
    data: {
      nextRunAt: nextSlot,
      pendingSlot: null,
      lastRunAt: now,
      lockedUntil: null,
      consecutiveFailures: 0,
    },
  })

  await prisma.notification.create({
    data: {
      userId: schedule.userId,
      title: 'Auto-Buy successful',
      body: `Your ${schedule.network} ${schedule.planGb} was delivered automatically to ${schedule.phone}.`,
      letter: 'D',
      isRead: false,
    },
  })

  return { outcome: 'successful' }
}

/** Moves the rule on to its next regular slot. */
async function advance(
  schedule: { id: string },
  slot: Date,
  nextSlot: Date,
  now: Date
): Promise<void> {
  await prisma.autoBuySchedule.update({
    where: { id: schedule.id },
    data: {
      nextRunAt: nextSlot,
      pendingSlot: null,
      lastRunAt: now,
      lockedUntil: null,
    },
  })
}

interface FailArgs {
  schedule: ExecuteArgs['schedule']
  execution: { id: string; attempt: number }
  slot: Date
  nextSlot: Date
  now: Date
  message: string
  kind: FailureKind
}

/**
 * Records a failed attempt.
 *
 * Retry policy:
 *  - transient problems (provider outage) are retried after 15/30/60 minutes
 *  - an empty wallet is retried after 6 hours, so the customer has time to
 *    fund the account
 *  - once the retries are used up the rule is paused and the customer is
 *    notified, so nothing is ever charged unexpectedly.
 */
async function fail(args: FailArgs): Promise<SlotOutcome> {
  const { schedule, execution, slot, nextSlot, now, message, kind } = args

  await prisma.autoBuyExecution.update({
    where: { id: execution.id },
    data: { status: 'Failed', error: message },
  })

  const failures = schedule.consecutiveFailures + 1
  const canRetry =
    failures < schedule.maxRetries && execution.attempt < schedule.maxRetries

  if (canRetry) {
    const delay = retryDelayMinutes(kind, execution.attempt)
    await prisma.autoBuySchedule.update({
      where: { id: schedule.id },
      data: {
        // Retry the *same* logical slot: the idempotency key and the
        // provider reference stay stable across attempts.
        nextRunAt: new Date(slot.getTime() + delay * 60_000),
        pendingSlot: slot,
        lastRunAt: now,
        lockedUntil: null,
        consecutiveFailures: failures,
      },
    })
  } else {
    await prisma.autoBuySchedule.update({
      where: { id: schedule.id },
      data: {
        nextRunAt: nextSlot,
        pendingSlot: null,
        lastRunAt: now,
        lockedUntil: null,
        consecutiveFailures: failures,
        status: 'Paused',
      },
    })
  }

  await prisma.notification.create({
    data: {
      userId: schedule.userId,
      title: 'Auto-Buy failed',
      body: message,
      letter: 'D',
      isRead: false,
    },
  })

  return { outcome: 'failed', error: message }
}
