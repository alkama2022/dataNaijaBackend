// Tests for buying a data bundle.
//
// These cover the three money bugs that were found before release:
// the client could choose the price, the wallet could go negative when
// two purchases arrived together, and two purchases in the same
// millisecond could collide on the reference.

import { prisma } from '@/lib/prisma'
import {
  PurchaseError,
  generateReference,
  purchaseDataBundle,
  resolveBundle,
} from '@/lib/purchases'
import { POST as purchase } from '@/app/api/purchase/route'
import { authHeader, jsonRequest } from './helpers/request'
import { createUser, freshDatabase } from './helpers/db'

const BASE = 'http://localhost:3000'

beforeEach(async () => {
  await freshDatabase()
})

describe('the price comes from the catalogue', () => {
  test('the price the client sends is ignored', async () => {
    const user = await createUser({ balance: 5000 })

    await purchaseDataBundle({
      userId: user.id,
      network: 'MTN',
      type: '1GB - 30 Days',
      dataType: 'SME',
      // A client that tries to pay a naira for a three hundred naira bundle.
      price: 1,
      phone: '08012345678',
    } as never)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(4700)

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(1)
    expect(transactions[0].amount).toBe(-300)
  })

  test('the route ignores the price the client sends too', async () => {
    const user = await createUser({ balance: 5000 })
    const headers = await authHeader(user.id)

    const response = await purchase(
      jsonRequest(
        'POST',
        `${BASE}/api/purchase`,
        { network: 'MTN', type: '1GB - 30 Days', dataType: 'SME', price: 1, phone: '08012345678' },
        headers
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.transaction.amount).toBe(-300)
    expect(body.newBalance).toBe(4700)
  })

  test('a bundle that is not in the catalogue is refused', async () => {
    const user = await createUser({ balance: 5000 })

    await expect(
      purchaseDataBundle({
        userId: user.id,
        network: 'MTN',
        type: '99GB',
        phone: '08012345678',
      })
    ).rejects.toThrow(PurchaseError)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(5000)
  })

  test('a disabled plan is refused', async () => {
    const plan = await prisma.dataPlan.findFirst({ where: { gb: '1GB' } })
    await prisma.dataPlan.update({
      where: { id: plan!.id },
      data: { isActive: false },
    })

    const user = await createUser({ balance: 5000 })
    await expect(
      purchaseDataBundle({
        userId: user.id,
        network: 'MTN',
        type: '1GB - 30 Days',
        dataType: 'SME',
        phone: '08012345678',
      })
    ).rejects.toThrow(PurchaseError)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(5000)
  })

  test('a bundle is found by its plan id as well', async () => {
    const plan = await prisma.dataPlan.findFirst({
      where: { gb: '2GB' },
    })
    const resolved = await resolveBundle({
      network: 'MTN',
      type: 'anything',
      dataType: 'SME',
      planId: plan!.id,
    })
    expect(resolved?.id).toBe(plan!.id)
  })
})

describe('the wallet never goes negative', () => {
  test('two purchases at the same time cannot overdraw the wallet', async () => {
    // Enough for one bundle, not two.
    const user = await createUser({ balance: 500 })

    const results = await Promise.allSettled([
      purchaseDataBundle({
        userId: user.id,
        network: 'MTN',
        type: '1GB - 30 Days',
        dataType: 'SME',
        phone: '08012345678',
      }),
      purchaseDataBundle({
        userId: user.id,
        network: 'MTN',
        type: '1GB - 30 Days',
        dataType: 'SME',
        phone: '08012345678',
      }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated!.balance).toBe(200)
    expect(updated!.balance).toBeGreaterThanOrEqual(0)

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(1)
  })

  test('many purchases at the same time still only charge what fits', async () => {
    const user = await createUser({ balance: 1000 })

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        purchaseDataBundle({
          userId: user.id,
          network: 'MTN',
          type: '1GB - 30 Days',
          dataType: 'SME',
          phone: '08012345678',
        })
      )
    )

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated!.balance).toBe(100)
    expect(updated!.balance).toBeGreaterThanOrEqual(0)

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(3)
  })

  test('a purchase the customer cannot afford does not touch the wallet', async () => {
    const user = await createUser({ balance: 100 })

    await expect(
      purchaseDataBundle({
        userId: user.id,
        network: 'MTN',
        type: '1GB - 30 Days',
        dataType: 'SME',
        phone: '08012345678',
      })
    ).rejects.toThrow(/Not enough balance/)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(100)

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(0)
  })
})

describe('the reference never collides', () => {
  test('two references made in the same millisecond are different', () => {
    const refs = Array.from({ length: 200 }, () => generateReference())
    expect(new Set(refs).size).toBe(200)
  })

  test('two purchases in the same millisecond both succeed', async () => {
    const user = await createUser({ balance: 5000 })

    const results = await Promise.all([
      purchaseDataBundle({
        userId: user.id,
        network: 'MTN',
        type: '1GB - 30 Days',
        dataType: 'SME',
        phone: '08012345678',
      }),
      purchaseDataBundle({
        userId: user.id,
        network: 'MTN',
        type: '1GB - 30 Days',
        dataType: 'SME',
        phone: '08012345678',
      }),
    ])

    expect(results[0].transaction.ref).not.toBe(results[1].transaction.ref)
    expect(results[0].transaction.id).not.toBe(results[1].transaction.id)
  })
})

describe('a repeated request is not charged twice', () => {
  test('the same idempotency key returns the first purchase', async () => {
    const user = await createUser({ balance: 5000 })

    const first = await purchaseDataBundle({
      userId: user.id,
      network: 'MTN',
      type: '1GB - 30 Days',
      dataType: 'SME',
      phone: '08012345678',
      idempotencyKey: 'order-123',
    })
    const second = await purchaseDataBundle({
      userId: user.id,
      network: 'MTN',
      type: '1GB - 30 Days',
      dataType: 'SME',
      phone: '08012345678',
      idempotencyKey: 'order-123',
    })

    expect(first.replayed).toBe(false)
    expect(second.replayed).toBe(true)
    expect(second.transaction.id).toBe(first.transaction.id)
    expect(second.transaction.ref).toBe(first.transaction.ref)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(4700)

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(1)
  })

  test('the same key sent at the same time only charges once', async () => {
    const user = await createUser({ balance: 5000 })

    const results = await Promise.all([
      purchaseDataBundle({
        userId: user.id,
        network: 'MTN',
        type: '1GB - 30 Days',
        dataType: 'SME',
        phone: '08012345678',
        idempotencyKey: 'order-456',
      }),
      purchaseDataBundle({
        userId: user.id,
        network: 'MTN',
        type: '1GB - 30 Days',
        dataType: 'SME',
        phone: '08012345678',
        idempotencyKey: 'order-456',
      }),
    ])

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(4700)

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
    })
    expect(transactions).toHaveLength(1)
  })

  test('two customers can use the same key', async () => {
    const first = await createUser({ id: 'u1', phone: '08011111111' })
    const second = await createUser({ id: 'u2', phone: '08022222222' })

    await purchaseDataBundle({
      userId: first.id,
      network: 'MTN',
      type: '1GB - 30 Days',
      dataType: 'SME',
      phone: '08011111111',
      idempotencyKey: 'shared-key',
    })
    await purchaseDataBundle({
      userId: second.id,
      network: 'MTN',
      type: '1GB - 30 Days',
      dataType: 'SME',
      phone: '08022222222',
      idempotencyKey: 'shared-key',
    })

    const transactions = await prisma.transaction.findMany()
    expect(transactions).toHaveLength(2)
  })

  test('the route honours the Idempotency-Key header', async () => {
    const user = await createUser({ balance: 5000 })
    const headers = {
      ...(await authHeader(user.id)),
      'idempotency-key': 'mobile-order-1',
    }

    const first = await purchase(
      jsonRequest(
        'POST',
        `${BASE}/api/purchase`,
        { network: 'MTN', type: '1GB - 30 Days', dataType: 'SME', price: 300, phone: '08012345678' },
        headers
      )
    )
    const second = await purchase(
      jsonRequest(
        'POST',
        `${BASE}/api/purchase`,
        { network: 'MTN', type: '1GB - 30 Days', dataType: 'SME', price: 300, phone: '08012345678' },
        headers
      )
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const firstBody = await first.json()
    const secondBody = await second.json()
    expect(secondBody.replayed).toBe(true)
    expect(secondBody.transaction.ref).toBe(firstBody.transaction.ref)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.balance).toBe(4700)
  })
})
