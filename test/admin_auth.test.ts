// Tests for who may use the admin panel.
//
// The panel is a server-rendered app, so the checks that matter are:
//  - a customer who is not an admin cannot get in;
//  - a suspended admin cannot get in;
//  - an expired or forged token cannot get in;
//  - the admin API refuses a request without the shared key.

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/auth'
import { getAdminUser } from '@/lib/admin/session'
import { GET as listAdminAutoBuy } from '@/app/api/admin/auto-buy/route'
import { GET as getAdminAutoBuy } from '@/app/api/admin/auto-buy/[id]/route'
import { createUser, freshDatabase } from './helpers/db'

const BASE = 'http://localhost:3000'

/** The cookie the admin session lives in. */
const COOKIE = 'dn_admin_session'

/** The cookie the request carries. Replaced per test. */
let cookieValue: string | null = null

jest.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) =>
      name === 'dn_admin_session' && cookieValue
        ? { name, value: cookieValue }
        : undefined,
  }),
}))

beforeEach(async () => {
  cookieValue = null
  await freshDatabase()
})

describe('the admin session', () => {
  test('there is no session without a cookie', async () => {
    expect(await getAdminUser()).toBeNull()
  })

  test('a customer who is not an admin cannot get in', async () => {
    const user = await createUser({ phone: '08011111111' })
    cookieValue = await signToken({
      userId: user.id,
      phone: user.phone,
    } as { userId: string; phone: string })

    expect(await getAdminUser()).toBeNull()
  })

  test('a suspended admin cannot get in', async () => {
    const admin = await createUser({
      phone: '08022222222',
      isAdmin: true,
      isSuspended: true,
    })
    cookieValue = await signToken({
      userId: admin.id,
      phone: admin.phone,
    } as { userId: string; phone: string })

    expect(await getAdminUser()).toBeNull()
  })

  test('a forged token cannot get in', async () => {
    cookieValue = 'not-a-real-token'
    expect(await getAdminUser()).toBeNull()
  })

  test('an admin gets in', async () => {
    const admin = await createUser({
      phone: '08033333333',
      isAdmin: true,
    })
    cookieValue = await signToken({
      userId: admin.id,
      phone: admin.phone,
    } as { userId: string; phone: string })

    const user = await getAdminUser()
    expect(user?.id).toBe(admin.id)
  })
})

describe('the admin API', () => {
  const KEY = 'test-admin-key'
  const originalKey = process.env.ADMIN_API_KEY

  beforeEach(() => {
    process.env.ADMIN_API_KEY = KEY
  })

  afterAll(() => {
    process.env.ADMIN_API_KEY = originalKey
  })

  test('a request without the key is refused', async () => {
    const response = await listAdminAutoBuy(
      new NextRequest(new Request(`${BASE}/api/admin/auto-buy`))
    )
    expect(response.status).toBe(401)
  })

  test('a request with the wrong key is refused', async () => {
    const response = await listAdminAutoBuy(
      new NextRequest(
        new Request(`${BASE}/api/admin/auto-buy`, {
          headers: { 'x-admin-key': 'wrong-key' },
        })
      )
    )
    expect(response.status).toBe(401)
  })

  test('the key can be sent as a bearer token', async () => {
    const response = await listAdminAutoBuy(
      new NextRequest(
        new Request(`${BASE}/api/admin/auto-buy`, {
          headers: { authorization: `Bearer ${KEY}` },
        })
      )
    )
    expect(response.status).toBe(200)
  })

  test('the right key gets the list', async () => {
    const response = await listAdminAutoBuy(
      new NextRequest(
        new Request(`${BASE}/api/admin/auto-buy`, {
          headers: { 'x-admin-key': KEY },
        })
      )
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test('a single rule is protected too', async () => {
    const user = await createUser({ phone: '08044444444' })
    const schedule = await prisma.autoBuySchedule.create({
      data: {
        userId: user.id,
        network: 'MTN',
        planType: 'SME',
        planGb: '1GB',
        planDays: '30 Days',
        price: 300,
        phone: user.phone,
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

    const refused = await getAdminAutoBuy(
      new NextRequest(
        new Request(`${BASE}/api/admin/auto-buy/${schedule.id}`, {
          headers: { 'x-admin-key': 'wrong-key' },
        })
      ),
      { params: { id: schedule.id } }
    )
    expect(refused.status).toBe(401)

    const allowed = await getAdminAutoBuy(
      new NextRequest(
        new Request(`${BASE}/api/admin/auto-buy/${schedule.id}`, {
          headers: { 'x-admin-key': KEY },
        })
      ),
      { params: { id: schedule.id } }
    )
    expect(allowed.status).toBe(200)
    const body = await allowed.json()
    expect(body.schedule.id).toBe(schedule.id)
  })

  test('the key is not configured, so nothing is allowed', async () => {
    delete process.env.ADMIN_API_KEY
    const response = await listAdminAutoBuy(
      new NextRequest(
        new Request(`${BASE}/api/admin/auto-buy`, {
          headers: { 'x-admin-key': 'test-admin-key' },
        })
      )
    )
    expect(response.status).toBe(401)
  })
})
