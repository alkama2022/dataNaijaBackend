// Integration tests for the Auto-Buy scheduler.
//
// They run against a real PostgreSQL database and cover the money-safety
// rules: no negative wallet, no duplicate charges, no purchase without a
// confirmed provider delivery, correct retry behaviour.

import { prisma } from '@/lib/prisma'
import { runDueAutoBuySchedules } from '@/lib/auto_buy/runner'
import type {
  DataProvider,
  ProviderPurchaseInput,
} from '@/lib/auto_buy/provider'
import { buildTransactionRef } from '@/lib/auto_buy/provider'
import { createUser, freshDatabase } from './helpers/db'

/** A provider that records what it was asked to deliver. */
function fakeProvider(options: {
  price?: number
  available?: boolean
  failWith?: string
} = {}) {
  const calls: ProviderPurchaseInput[] = []

  const provider: DataProvider = {
    async resolveBundle() {
      if (options.available === false) {
        return {
          price: 0,
          available: false,
          planId: null,
          reason: 'This bundle is no longer available.',
        }
      }
      return { price: options.price ?? 300, available: true, planId: 'plan-1', reason: null }
    },
    async purchase(input) {
      calls.push(input)
      if (options.failWith) {
        return { success: false, error: options.failWith }
      }
      return { success: true, reference: `PRV-${calls.length}` }
    },
  }

  return { provider, calls }
}

/** Creates an active rule that is due to run. */
async function createSchedule(options: {
  userId: string
  balance?: number
  nextRunAt: Date
  anchorAt?: Date
  maxRetries?: number
}) {
  return await prisma.autoBuySchedule.create({
    data: {
      userId: options.userId,
      network: 'MTN',
      planType: 'SME',
      planGb: '1GB',
      planDays: '30 Days',
      planId: 'plan-1',
      price: 300,
      phone: '08012345678',
      frequency: 'daily',
      interval: 1,
      unit: 'days',
      daysOfWeek: [],
      timeOfDay: '08:00',
      timezone: 'Africa/Lagos',
      status: 'Active',
      anchorAt: options.anchorAt ?? options.nextRunAt,
      nextRunAt: options.nextRunAt,
      consecutiveFailures: 0,
      maxRetries: options.maxRetries ?? 3,
      consentAt: new Date(),
    },
  })
}

beforeEach(async () => {
  await freshDatabase()
})

describe('Auto-Buy runner — successful purchase', () => {
  test('charges the wallet, records the transaction and advances the schedule', async () => {
    const user = await createUser({ balance: 5000 })
    const slot = new Date('2026-10-20T07:00:00.000Z') // 08:00 Lagos
    const schedule = await createSchedule({ userId: user.id, nextRunAt: slot })

    const { provider, calls } = fakeProvider({ price: 300 })
    const summary = await runDueAutoBuySchedules({
      now: new Date('2026-10-20T07:00:30.000Z'),
      provider,
    })

    expect(summary.processed).toBe(1)
    expect(summary.successful).toBe(1)
    expect(calls).toHaveLength(1)

    // The wallet was debited exactly once.
    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(4700)

    // The transaction is in the history.
    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(1)
    expect(transactions[0].amount).toBe(-300)
    expect(transactions[0].status).toBe('Successful')
    expect(transactions[0].title).toBe('Auto-Buy Data Purchase')
    expect(transactions[0].autoBuyScheduleId).toBe(schedule.id)

    // The execution is recorded and the customer is notified.
    const executions = await prisma.autoBuyExecution.findMany({
      where: { scheduleId: schedule.id },
    })
    expect(executions).toHaveLength(1)
    expect(executions[0].status).toBe('Successful')
    expect(executions[0].amount).toBe(300)
    expect(executions[0].ref).toBe(buildTransactionRef(schedule.id, slot))

    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
    })
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe('Auto-Buy successful')

    // The next slot is tomorrow, same wall-clock time.
    const reloaded = await prisma.autoBuySchedule.findUnique({
      where: { id: schedule.id },
    })
    expect(reloaded?.nextRunAt.toISOString()).toBe('2026-10-21T07:00:00.000Z')
    expect(reloaded?.consecutiveFailures).toBe(0)
  })
})

describe('Auto-Buy runner — money safety', () => {
  test('does not purchase when the wallet is short and schedules a retry', async () => {
    const user = await createUser({ balance: 100 })
    const slot = new Date('2026-10-20T07:00:00.000Z')
    const schedule = await createSchedule({ userId: user.id, nextRunAt: slot })

    const { provider, calls } = fakeProvider({ price: 300 })
    const summary = await runDueAutoBuySchedules({
      now: new Date('2026-10-20T07:00:30.000Z'),
      provider,
    })

    expect(summary.failed).toBe(1)
    // The provider was never contacted — no data was delivered.
    expect(calls).toHaveLength(0)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(100) // untouched, never negative

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(0)

    const executions = await prisma.autoBuyExecution.findMany({
      where: { scheduleId: schedule.id },
    })
    expect(executions[0].status).toBe('Failed')
    expect(executions[0].amount).toBe(0)

    // The retry happens six hours later, on the same logical slot.
    const reloaded = await prisma.autoBuySchedule.findUnique({
      where: { id: schedule.id },
    })
    expect(reloaded?.status).toBe('Active')
    expect(reloaded?.nextRunAt.toISOString()).toBe('2026-10-20T13:00:00.000Z')
    expect(reloaded?.pendingSlot?.toISOString()).toBe(slot.toISOString())
  })

  test('never lets the wallet go negative', async () => {
    const user = await createUser({ balance: 300 })
    const slot = new Date('2026-10-20T07:00:00.000Z')
    await createSchedule({ userId: user.id, nextRunAt: slot })

    const { provider } = fakeProvider({ price: 300 })
    await runDueAutoBuySchedules({
      now: new Date('2026-10-20T07:00:30.000Z'),
      provider,
    })

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(0)
    expect(updated!.balance).toBeGreaterThanOrEqual(0)
  })

  test('a failed delivery is not charged and is retried', async () => {
    const user = await createUser({ balance: 5000 })
    const slot = new Date('2026-10-20T07:00:00.000Z')
    const schedule = await createSchedule({ userId: user.id, nextRunAt: slot })

    const { provider } = fakeProvider({ failWith: 'Provider is down.' })
    const summary = await runDueAutoBuySchedules({
      now: new Date('2026-10-20T07:00:30.000Z'),
      provider,
    })

    expect(summary.failed).toBe(1)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(5000) // no charge for a failed delivery

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(0)

    const reloaded = await prisma.autoBuySchedule.findUnique({
      where: { id: schedule.id },
    })
    // 15 minutes back-off for a transient provider error.
    expect(reloaded?.nextRunAt.toISOString()).toBe('2026-10-20T07:15:00.000Z')
    expect(reloaded?.pendingSlot?.toISOString()).toBe(slot.toISOString())
    expect(reloaded?.consecutiveFailures).toBe(1)
  })

  test('pauses the rule once the retries are used up', async () => {
    const user = await createUser({ balance: 5000 })
    const slot = new Date('2026-10-20T07:00:00.000Z')
    const schedule = await createSchedule({
      userId: user.id,
      nextRunAt: slot,
      maxRetries: 1,
    })

    const { provider } = fakeProvider({ failWith: 'Provider is down.' })
    await runDueAutoBuySchedules({
      now: new Date('2026-10-20T07:00:30.000Z'),
      provider,
    })

    const reloaded = await prisma.autoBuySchedule.findUnique({
      where: { id: schedule.id },
    })
    expect(reloaded?.status).toBe('Paused')
    expect(reloaded?.consecutiveFailures).toBe(1)

    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
    })
    expect(notifications[0].title).toBe('Auto-Buy failed')
  })

  test('does not purchase a bundle that is no longer available', async () => {
    const user = await createUser({ balance: 5000 })
    const slot = new Date('2026-10-20T07:00:00.000Z')
    const schedule = await createSchedule({ userId: user.id, nextRunAt: slot })

    const { provider, calls } = fakeProvider({ available: false })
    const summary = await runDueAutoBuySchedules({
      now: new Date('2026-10-20T07:00:30.000Z'),
      provider,
    })

    expect(summary.failed).toBe(1)
    expect(calls).toHaveLength(0)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(5000)

    const executions = await prisma.autoBuyExecution.findMany({
      where: { scheduleId: schedule.id },
    })
    expect(executions[0].status).toBe('Failed')
    expect(executions[0].error).toContain('no longer available')
  })
})

describe('Auto-Buy runner — duplicate execution', () => {
  test('running the scheduler twice does not charge twice', async () => {
    const user = await createUser({ balance: 5000 })
    const slot = new Date('2026-10-20T07:00:00.000Z')
    await createSchedule({ userId: user.id, nextRunAt: slot })

    const { provider, calls } = fakeProvider({ price: 300 })
    const now = new Date('2026-10-20T07:00:30.000Z')

    await runDueAutoBuySchedules({ now, provider })
    // A second cron tick for the very same slot.
    await runDueAutoBuySchedules({ now, provider })

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(4700) // charged once

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  test('a slot that already succeeded is skipped', async () => {
    const user = await createUser({ balance: 5000 })
    const slot = new Date('2026-10-20T07:00:00.000Z')
    const schedule = await createSchedule({ userId: user.id, nextRunAt: slot })

    // Pretend the slot was already executed successfully.
    await prisma.autoBuyExecution.create({
      data: {
        scheduleId: schedule.id,
        userId: user.id,
        scheduledFor: slot,
        status: 'Successful',
        amount: 300,
        ref: buildTransactionRef(schedule.id, slot),
      },
    })

    const { provider, calls } = fakeProvider({ price: 300 })
    const summary = await runDueAutoBuySchedules({
      now: new Date('2026-10-20T07:00:30.000Z'),
      provider,
    })

    expect(summary.skipped).toBe(1)
    expect(calls).toHaveLength(0)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(5000)
  })

  test('two workers cannot execute the same slot', async () => {
    const user = await createUser({ balance: 5000 })
    const slot = new Date('2026-10-20T07:00:00.000Z')
    await createSchedule({ userId: user.id, nextRunAt: slot })

    const { provider } = fakeProvider({ price: 300 })
    const now = new Date('2026-10-20T07:00:30.000Z')

    // Both workers start at the same time — the lock must serialise them.
    await Promise.all([
      runDueAutoBuySchedules({ now, provider }),
      runDueAutoBuySchedules({ now, provider }),
    ])

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(4700)

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(1)
  })

  test('a missed slot is skipped instead of charging the customer', async () => {
    const user = await createUser({ balance: 5000 })
    const slot = new Date('2026-10-20T07:00:00.000Z')
    const schedule = await createSchedule({ userId: user.id, nextRunAt: slot })

    const { provider, calls } = fakeProvider({ price: 300 })
    // The server was down for six hours.
    const summary = await runDueAutoBuySchedules({
      now: new Date('2026-10-20T13:00:30.000Z'),
      provider,
      graceMinutes: 30,
    })

    expect(summary.skipped).toBe(1)
    expect(calls).toHaveLength(0)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(5000)

    const executions = await prisma.autoBuyExecution.findMany({
      where: { scheduleId: schedule.id },
    })
    expect(executions[0].status).toBe('Skipped')
  })
})

describe('Auto-Buy runner — schedule selection', () => {
  test('paused rules are not executed', async () => {
    const user = await createUser({ balance: 5000 })
    const slot = new Date('2026-10-20T07:00:00.000Z')
    const schedule = await createSchedule({ userId: user.id, nextRunAt: slot })
    await prisma.autoBuySchedule.update({
      where: { id: schedule.id },
      data: { status: 'Paused' },
    })

    const { provider, calls } = fakeProvider({ price: 300 })
    const summary = await runDueAutoBuySchedules({
      now: new Date('2026-10-20T07:00:30.000Z'),
      provider,
    })

    expect(summary.processed).toBe(0)
    expect(calls).toHaveLength(0)
  })

  test('rules that are not due yet are left alone', async () => {
    const user = await createUser({ balance: 5000 })
    const slot = new Date('2026-10-20T07:00:00.000Z')
    await createSchedule({ userId: user.id, nextRunAt: slot })

    const { provider, calls } = fakeProvider({ price: 300 })
    const summary = await runDueAutoBuySchedules({
      now: new Date('2026-10-20T06:00:00.000Z'),
      provider,
    })

    expect(summary.processed).toBe(0)
    expect(calls).toHaveLength(0)
  })
})
