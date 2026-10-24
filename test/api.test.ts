// Regression tests for the existing DataNaija API.
//
// They cover the wallet, the data purchase flow and the authentication
// rules that the Auto-Buy feature builds on. They run against a real
// PostgreSQL database.

import { prisma } from '@/lib/prisma'
import { POST as signin } from '@/app/api/auth/signin/route'
import { POST as signup } from '@/app/api/auth/signup/route'
import { GET as networks } from '@/app/api/networks/route'
import { GET as dataPlans } from '@/app/api/data-plans/route'
import { POST as purchase } from '@/app/api/purchase/route'
import { GET as walletBalance } from '@/app/api/wallet/balance/route'
import { POST as fundWallet } from '@/app/api/wallet/fund/route'
import { GET as walletTransactions } from '@/app/api/wallet/transactions/route'
// The route folder is literally named `%5Bid%5D` on disk.
import { GET as transactionDetail } from '@/app/api/transactions/%5Bid%5D/route'
import { authHeader, emptyRequest, jsonRequest } from './helpers/request'
import { createUser, freshDatabase } from './helpers/db'

const BASE = 'http://localhost:3000'

beforeEach(async () => {
  await freshDatabase()
})

// ── Auth ─────────────────────────────────────────────────────────

describe('Auth API', () => {
  test('POST /api/auth/signup rejects an invalid phone number', async () => {
    const response = await signup(
      jsonRequest('POST', `${BASE}/api/auth/signup`, {
        fullName: 'Test User',
        phone: '06012345678',
        password: 'password123',
      })
    )

    expect(response.status).toBe(400)
  })

  test('POST /api/auth/signup creates an account and returns a token', async () => {
    const response = await signup(
      jsonRequest('POST', `${BASE}/api/auth/signup`, {
        fullName: 'Test User',
        phone: '08012345678',
        password: 'password123',
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.token).toBeTruthy()
    expect(body.user.phone).toBe('08012345678')
    expect(body.user.balance).toBe(5000)
  })

  test('POST /api/auth/signup refuses a duplicate phone number', async () => {
    await createUser({ phone: '08012345678' })

    const response = await signup(
      jsonRequest('POST', `${BASE}/api/auth/signup`, {
        fullName: 'Test User',
        phone: '08012345678',
        password: 'password123',
      })
    )

    expect(response.status).toBe(409)
  })

  test('POST /api/auth/signin returns 401 for invalid credentials', async () => {
    await createUser({ phone: '08012345678' })

    const response = await signin(
      jsonRequest('POST', `${BASE}/api/auth/signin`, {
        phone: '08012345678',
        // Long enough to pass validation — the credentials themselves are
        // what must be rejected.
        password: 'wrongpassword',
      })
    )

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toBe('Invalid credentials')
  })

  test('POST /api/auth/signin rejects a malformed request with 400', async () => {
    const response = await signin(
      jsonRequest('POST', `${BASE}/api/auth/signin`, {
        phone: '08012345678',
        password: 'short',
      })
    )

    expect(response.status).toBe(400)
  })
})

// ── Catalogue ────────────────────────────────────────────────────

describe('Networks API', () => {
  test('GET /api/networks returns active networks', async () => {
    const response = await networks()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    expect(body[0].name).toBeDefined()
    expect(body[0].abbreviation).toBeDefined()
  })
})

describe('Data plans API', () => {
  test('GET /api/data-plans returns the plans of a network', async () => {
    const response = await dataPlans(
      emptyRequest('GET', `${BASE}/api/data-plans?network=MTN&type=SME`)
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    expect(body[0].network.name).toBe('MTN')
  })
})

// ── Purchase ─────────────────────────────────────────────────────

describe('Purchase API', () => {
  test('POST /api/purchase returns 401 without an auth token', async () => {
    const response = await purchase(
      jsonRequest('POST', `${BASE}/api/purchase`, {
        network: 'MTN',
        type: '1GB - 30 Days',
        dataType: 'SME',
        price: 300,
        phone: '08012345678',
      })
    )

    expect(response.status).toBe(401)
  })

  test('POST /api/purchase debits the wallet and records the transaction', async () => {
    const user = await createUser({ balance: 5000 })
    const headers = await authHeader(user.id)

    const response = await purchase(
      jsonRequest(
        'POST',
        `${BASE}/api/purchase`,
        { network: 'MTN', type: '1GB - 30 Days', dataType: 'SME', price: 300, phone: '08012345678' },
        headers
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.newBalance).toBe(4700)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(4700)

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(1)
    expect(transactions[0].amount).toBe(-300)
    expect(transactions[0].typeKey).toBe('d')
  })

  test('POST /api/purchase refuses to spend more than the balance', async () => {
    const user = await createUser({ balance: 100 })
    const headers = await authHeader(user.id)

    const response = await purchase(
      jsonRequest(
        'POST',
        `${BASE}/api/purchase`,
        { network: 'MTN', type: '1GB - 30 Days', dataType: 'SME', price: 300, phone: '08012345678' },
        headers
      )
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('Not enough balance')

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(100) // never negative

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(0)
  })
})

// ── Wallet ───────────────────────────────────────────────────────

describe('Wallet API', () => {
  test('GET /api/wallet/balance returns the current balance', async () => {
    const user = await createUser({ balance: 4200 })
    const headers = await authHeader(user.id)

    const response = await walletBalance(
      emptyRequest('GET', `${BASE}/api/wallet/balance`, headers)
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.balance).toBe(4200)
  })

  test('POST /api/wallet/fund credits the wallet and records the transaction', async () => {
    const user = await createUser({ balance: 1000 })
    const headers = await authHeader(user.id)

    const response = await fundWallet(
      jsonRequest(
        'POST',
        `${BASE}/api/wallet/fund`,
        { amount: 2000, method: 'Card Payment' },
        headers
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.newBalance).toBe(3000)

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(1)
    expect(transactions[0].amount).toBe(2000)
    expect(transactions[0].typeKey).toBe('w')
  })

  test('GET /api/wallet/transactions only returns the customer transactions', async () => {
    const owner = await createUser({ phone: '08011111111' })
    const other = await createUser({ phone: '08022222222' })

    await prisma.transaction.create({
      data: {
        userId: owner.id,
        title: 'Data Purchase',
        subtitle: 'MTN 1GB',
        amount: -300,
        status: 'Successful',
        phone: '08011111111',
        ref: 'DN-OWNER-1',
        typeKey: 'd',
      },
    })
    await prisma.transaction.create({
      data: {
        userId: other.id,
        title: 'Data Purchase',
        subtitle: 'Glo 2GB',
        amount: -600,
        status: 'Successful',
        phone: '08022222222',
        ref: 'DN-OTHER-1',
        typeKey: 'd',
      },
    })

    const headers = await authHeader(owner.id)
    const response = await walletTransactions(
      emptyRequest('GET', `${BASE}/api/wallet/transactions`, headers)
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveLength(1)
    expect(body[0].ref).toBe('DN-OWNER-1')
  })

  test('GET /api/transactions/:id does not leak another customer transaction', async () => {
    const owner = await createUser({ phone: '08011111111' })
    const attacker = await createUser({ phone: '08022222222' })

    const transaction = await prisma.transaction.create({
      data: {
        userId: owner.id,
        title: 'Data Purchase',
        subtitle: 'MTN 1GB',
        amount: -300,
        status: 'Successful',
        phone: '08011111111',
        ref: 'DN-OWNER-2',
        typeKey: 'd',
      },
    })

    const headers = await authHeader(attacker.id)
    const response = await transactionDetail(
      emptyRequest('GET', `${BASE}/api/transactions/${transaction.id}`, headers),
      { params: { id: transaction.id } }
    )

    expect(response.status).toBe(404)
  })
})
