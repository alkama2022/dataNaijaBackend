// Integration tests for the Auto-Buy API routes.
//
// They cover authentication, ownership (a customer only ever sees their
// own rules), the consent requirement and the pause/resume/edit/delete
// lifecycle.

import { prisma } from '@/lib/prisma'
import { GET as listSchedules, POST as createSchedule } from '@/app/api/auto-buy/route'
import {
  GET as getSchedule,
  PATCH as patchSchedule,
  DELETE as deleteSchedule,
} from '@/app/api/auto-buy/[id]/route'
import { GET as listExecutions } from '@/app/api/auto-buy/[id]/executions/route'
import { POST as runSchedules } from '@/app/api/auto-buy/run/route'
import { authHeader, emptyRequest, jsonRequest } from './helpers/request'
import { createUser, freshDatabase } from './helpers/db'

const BASE = 'http://localhost:3000'

/** Lagos is UTC+1 all year round. */
const LAGOS_OFFSET_MS = 3_600_000

/**
 * The next 08:00 in Lagos, as a UTC instant, and the calendar date it
 * falls on. The tests use it so they do not depend on the day they run.
 */
function nextEightOClockLagos(): { iso: string; date: string } {
  const lagosNow = new Date(Date.now() + LAGOS_OFFSET_MS)
  const tomorrow = new Date(
    Date.UTC(
      lagosNow.getUTCFullYear(),
      lagosNow.getUTCMonth(),
      lagosNow.getUTCDate() + 1,
      8,
      0,
      0,
    )
  )
  return {
    iso: new Date(tomorrow.getTime() - LAGOS_OFFSET_MS).toISOString(),
    date: tomorrow.toISOString().slice(0, 10),
  }
}

/** A valid rule payload. */
function rulePayload(overrides: Record<string, unknown> = {}) {
  return {
    network: 'MTN',
    planType: 'SME',
    planGb: '1GB',
    planDays: '30 Days',
    price: 300,
    phone: '08012345678',
    frequency: 'daily',
    timeOfDay: '08:00',
    startDate: nextEightOClockLagos().date,
    timezone: 'Africa/Lagos',
    consent: true,
    ...overrides,
  }
}

beforeEach(async () => {
  await freshDatabase()
})

describe('POST /api/auto-buy', () => {
  test('creates a rule and returns the next purchase time', async () => {
    const user = await createUser()
    const headers = await authHeader(user.id)

    const response = await createSchedule(
      jsonRequest('POST', `${BASE}/api/auto-buy`, rulePayload(), headers)
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.schedule.frequency).toBe('daily')
    expect(body.schedule.status).toBe('Active')
    expect(body.schedule.price).toBe(300)
    expect(body.schedule.summary).toBe('Every day at 8:00 AM')
    expect(body.schedule.nextRunAt).toBe(nextEightOClockLagos().iso)
    expect(body.schedule.nextRunLabel).toContain('8:00 AM WAT')
  })

  test('requires explicit consent', async () => {
    const user = await createUser()
    const headers = await authHeader(user.id)

    const response = await createSchedule(
      jsonRequest(
        'POST',
        `${BASE}/api/auto-buy`,
        rulePayload({ consent: false }),
        headers
      )
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid input')
    expect(body.details.consent).toBeDefined()

    const schedules = await prisma.autoBuySchedule.findMany()
    expect(schedules).toHaveLength(0)
  })

  test('rejects an invalid phone number', async () => {
    const user = await createUser()
    const headers = await authHeader(user.id)

    const response = await createSchedule(
      jsonRequest(
        'POST',
        `${BASE}/api/auto-buy`,
        rulePayload({ phone: '12345' }),
        headers
      )
    )

    expect(response.status).toBe(400)
  })

  test('rejects a weekly rule without any day selected', async () => {
    const user = await createUser()
    const headers = await authHeader(user.id)

    const response = await createSchedule(
      jsonRequest(
        'POST',
        `${BASE}/api/auto-buy`,
        rulePayload({ frequency: 'weekly', daysOfWeek: [] }),
        headers
      )
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('day of the week')
  })

  test('rejects a bundle that is not in the catalogue', async () => {
    const user = await createUser()
    const headers = await authHeader(user.id)

    const response = await createSchedule(
      jsonRequest(
        'POST',
        `${BASE}/api/auto-buy`,
        rulePayload({ planGb: '99GB' }),
        headers
      )
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('no longer available')
  })

  test('requires a signed-in customer', async () => {
    const response = await createSchedule(
      jsonRequest('POST', `${BASE}/api/auto-buy`, rulePayload())
    )
    expect(response.status).toBe(401)
  })

  test('stores the price from the catalogue, not the one the client sent', async () => {
    const user = await createUser()
    const headers = await authHeader(user.id)

    const response = await createSchedule(
      jsonRequest(
        'POST',
        `${BASE}/api/auto-buy`,
        rulePayload({ price: 1 }),
        headers
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.schedule.price).toBe(300)
  })
})

describe('GET /api/auto-buy', () => {
  test('lists only the signed-in customer rules', async () => {
    const owner = await createUser({ phone: '08011111111' })
    const other = await createUser({ phone: '08022222222' })
    const headers = await authHeader(owner.id)

    await prisma.autoBuySchedule.create({
      data: {
        userId: owner.id,
        network: 'MTN',
        planType: 'SME',
        planGb: '1GB',
        planDays: '30 Days',
        price: 300,
        phone: '08011111111',
        frequency: 'daily',
        interval: 1,
        unit: 'days',
        daysOfWeek: [],
        timeOfDay: '08:00',
        timezone: 'Africa/Lagos',
        status: 'Active',
        anchorAt: new Date('2026-10-20T07:00:00.000Z'),
        nextRunAt: new Date('2026-10-20T07:00:00.000Z'),
        consentAt: new Date(),
      },
    })

    const response = await listSchedules(
      emptyRequest('GET', `${BASE}/api/auto-buy`, headers)
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveLength(1)
    expect(body[0].userId).toBe(owner.id)
    expect(body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: other.id })])
    )
  })

  test('requires a signed-in customer', async () => {
    const response = await listSchedules(
      emptyRequest('GET', `${BASE}/api/auto-buy`)
    )
    expect(response.status).toBe(401)
  })
})

describe('GET/PATCH/DELETE /api/auto-buy/:id', () => {
  async function createOwnedSchedule(userId: string) {
    return await prisma.autoBuySchedule.create({
      data: {
        userId,
        network: 'MTN',
        planType: 'SME',
        planGb: '1GB',
        planDays: '30 Days',
        price: 300,
        phone: '08012345678',
        frequency: 'daily',
        interval: 1,
        unit: 'days',
        daysOfWeek: [],
        timeOfDay: '08:00',
        timezone: 'Africa/Lagos',
        status: 'Active',
        anchorAt: new Date('2026-10-20T07:00:00.000Z'),
        nextRunAt: new Date('2026-10-20T07:00:00.000Z'),
        consentAt: new Date(),
      },
    })
  }

  test('returns the rule with its execution history', async () => {
    const user = await createUser()
    const headers = await authHeader(user.id)
    const schedule = await createOwnedSchedule(user.id)

    await prisma.autoBuyExecution.create({
      data: {
        scheduleId: schedule.id,
        userId: user.id,
        scheduledFor: new Date('2026-10-20T07:00:00.000Z'),
        status: 'Successful',
        amount: 300,
        ref: 'DNA-TEST-1',
      },
    })

    const response = await getSchedule(
      emptyRequest('GET', `${BASE}/api/auto-buy/${schedule.id}`, headers),
      { params: { id: schedule.id } }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.schedule.id).toBe(schedule.id)
    expect(body.executions).toHaveLength(1)
    expect(body.executions[0].status).toBe('Successful')
  })

  test('does not leak another customer rule', async () => {
    const owner = await createUser({ phone: '08011111111' })
    const attacker = await createUser({ phone: '08022222222' })
    const headers = await authHeader(attacker.id)
    const schedule = await createOwnedSchedule(owner.id)

    const response = await getSchedule(
      emptyRequest('GET', `${BASE}/api/auto-buy/${schedule.id}`, headers),
      { params: { id: schedule.id } }
    )

    expect(response.status).toBe(404)
  })

  test('pauses a rule', async () => {
    const user = await createUser()
    const headers = await authHeader(user.id)
    const schedule = await createOwnedSchedule(user.id)

    const response = await patchSchedule(
      jsonRequest(
        'PATCH',
        `${BASE}/api/auto-buy/${schedule.id}`,
        { status: 'Paused' },
        headers
      ),
      { params: { id: schedule.id } }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.schedule.status).toBe('Paused')
  })

  test('resuming a rule requires consent', async () => {
    const user = await createUser()
    const headers = await authHeader(user.id)
    const schedule = await createOwnedSchedule(user.id)
    await prisma.autoBuySchedule.update({
      where: { id: schedule.id },
      data: { status: 'Paused' },
    })

    const refused = await patchSchedule(
      jsonRequest(
        'PATCH',
        `${BASE}/api/auto-buy/${schedule.id}`,
        { status: 'Active' },
        headers
      ),
      { params: { id: schedule.id } }
    )
    expect(refused.status).toBe(400)

    const accepted = await patchSchedule(
      jsonRequest(
        'PATCH',
        `${BASE}/api/auto-buy/${schedule.id}`,
        { status: 'Active', consent: true },
        headers
      ),
      { params: { id: schedule.id } }
    )
    expect(accepted.status).toBe(200)
    const body = await accepted.json()
    expect(body.schedule.status).toBe('Active')
    // The next purchase is in the future again.
    expect(new Date(body.schedule.nextRunAt).getTime()).toBeGreaterThan(
      Date.now() - 1000
    )
  })

  test('edits the bundle and the schedule', async () => {
    const user = await createUser()
    const headers = await authHeader(user.id)
    const schedule = await createOwnedSchedule(user.id)

    const response = await patchSchedule(
      jsonRequest(
        'PATCH',
        `${BASE}/api/auto-buy/${schedule.id}`,
        {
          frequency: 'weekly',
          daysOfWeek: [1, 3, 5],
          timeOfDay: '20:00',
          planGb: '2GB',
        },
        headers
      ),
      { params: { id: schedule.id } }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.schedule.frequency).toBe('weekly')
    expect(body.schedule.daysOfWeek).toEqual([1, 3, 5])
    expect(body.schedule.timeOfDay).toBe('20:00')
    expect(body.schedule.planGb).toBe('2GB')
    expect(body.schedule.price).toBe(600)
    expect(body.schedule.summary).toBe('Mon, Wed, Fri at 8:00 PM')
  })

  test('deletes a rule', async () => {
    const user = await createUser()
    const headers = await authHeader(user.id)
    const schedule = await createOwnedSchedule(user.id)

    const response = await deleteSchedule(
      emptyRequest('DELETE', `${BASE}/api/auto-buy/${schedule.id}`, headers),
      { params: { id: schedule.id } }
    )

    expect(response.status).toBe(200)
    const remaining = await prisma.autoBuySchedule.findMany()
    expect(remaining).toHaveLength(0)
  })

  test('cannot delete another customer rule', async () => {
    const owner = await createUser({ phone: '08011111111' })
    const attacker = await createUser({ phone: '08022222222' })
    const headers = await authHeader(attacker.id)
    const schedule = await createOwnedSchedule(owner.id)

    const response = await deleteSchedule(
      emptyRequest('DELETE', `${BASE}/api/auto-buy/${schedule.id}`, headers),
      { params: { id: schedule.id } }
    )

    expect(response.status).toBe(404)
    const remaining = await prisma.autoBuySchedule.findMany()
    expect(remaining).toHaveLength(1)
  })
})

describe('GET /api/auto-buy/:id/executions', () => {
  test('returns the history of the customer rule only', async () => {
    const owner = await createUser({ phone: '08011111111' })
    const attacker = await createUser({ phone: '08022222222' })
    const schedule = await prisma.autoBuySchedule.create({
      data: {
        userId: owner.id,
        network: 'MTN',
        planType: 'SME',
        planGb: '1GB',
        planDays: '30 Days',
        price: 300,
        phone: '08011111111',
        frequency: 'daily',
        interval: 1,
        unit: 'days',
        daysOfWeek: [],
        timeOfDay: '08:00',
        timezone: 'Africa/Lagos',
        status: 'Active',
        anchorAt: new Date(),
        nextRunAt: new Date(),
        consentAt: new Date(),
      },
    })

    await prisma.autoBuyExecution.create({
      data: {
        scheduleId: schedule.id,
        userId: owner.id,
        scheduledFor: new Date('2026-10-20T07:00:00.000Z'),
        status: 'Failed',
        error: 'Not enough balance.',
      },
    })

    const ownerHeaders = await authHeader(owner.id)
    const own = await listExecutions(
      emptyRequest(
        'GET',
        `${BASE}/api/auto-buy/${schedule.id}/executions`,
        ownerHeaders
      ),
      { params: { id: schedule.id } }
    )
    expect(own.status).toBe(200)
    expect((await own.json())).toHaveLength(1)

    const attackerHeaders = await authHeader(attacker.id)
    const forbidden = await listExecutions(
      emptyRequest(
        'GET',
        `${BASE}/api/auto-buy/${schedule.id}/executions`,
        attackerHeaders
      ),
      { params: { id: schedule.id } }
    )
    expect(forbidden.status).toBe(404)
  })
})

describe('POST /api/auto-buy/run', () => {
  test('is protected by the cron secret', async () => {
    const response = await runSchedules(
      emptyRequest('POST', `${BASE}/api/auto-buy/run`)
    )
    expect(response.status).toBe(401)
  })

  test('runs the due schedules when the secret is provided', async () => {
    const user = await createUser({ balance: 5000 })
    // The 1GB bundle costs 300 in the seeded catalogue.
    const plan = await prisma.dataPlan.findFirst({
      where: { gb: '1GB', type: 'SME' },
    })
    await prisma.autoBuySchedule.create({
      data: {
        userId: user.id,
        network: 'MTN',
        planType: 'SME',
        planGb: '1GB',
        planDays: '30 Days',
        planId: plan?.id ?? null,
        price: 300,
        phone: '08012345678',
        frequency: 'daily',
        interval: 1,
        unit: 'days',
        daysOfWeek: [],
        timeOfDay: '08:00',
        timezone: 'Africa/Lagos',
        status: 'Active',
        anchorAt: new Date(Date.now() - 60_000),
        nextRunAt: new Date(Date.now() - 30_000),
        consentAt: new Date(),
      },
    })

    const response = await runSchedules(
      emptyRequest('POST', `${BASE}/api/auto-buy/run`, {
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.processed).toBe(1)
    expect(body.successful).toBe(1)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(4700)
  })
})
