/**
 * Database helpers for the integration tests.
 *
 * The tests run against a real PostgreSQL database (see
 * `test/setup-env.ts` for the default connection string). Every test
 * starts from a clean, seeded database.
 */
import { prisma } from '@/lib/prisma'

/** Removes every row from the tables the tests use. */
export async function resetDatabase(): Promise<void> {
  await prisma.autoBuyExecution.deleteMany()
  await prisma.autoBuySchedule.deleteMany()
  await prisma.transaction.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.referral.deleteMany()
  await prisma.providerPlanCost.deleteMany()
  await prisma.dataPlan.deleteMany()
  await prisma.network.deleteMany()
  await prisma.provider.deleteMany()
  await prisma.setting.deleteMany()
  await prisma.user.deleteMany()
}

/** Seeds the networks and the bundle catalogue. */
export async function seedCatalogue(): Promise<void> {
  const networks = [
    { name: 'MTN', abbreviation: 'MTN', bgColor: '#FFCC00', fgColor: '#10231A' },
    { name: 'Airtel', abbreviation: 'Ai', bgColor: '#E40000', fgColor: '#FFFFFF' },
    { name: 'Glo', abbreviation: 'glo', bgColor: '#17A34A', fgColor: '#FFFFFF' },
    { name: '9mobile', abbreviation: '9m', bgColor: '#1F2937', fgColor: '#B7F34A' },
  ]

  for (const network of networks) {
    await prisma.network.create({
      data: { id: network.name, ...network, isActive: true },
    })
  }

  const plans = [
    { type: 'SME', gb: '500MB', days: '30 Days', price: 160 },
    { type: 'SME', gb: '1GB', days: '30 Days', price: 300 },
    { type: 'SME', gb: '2GB', days: '30 Days', price: 600 },
    { type: 'Gifting', gb: '1GB', days: '30 Days', price: 350 },
  ]

  for (const plan of plans) {
    await prisma.dataPlan.create({
      data: {
        ...plan,
        network: { connect: { id: 'MTN' } },
        isActive: true,
      },
    })
  }
}

/** Creates a customer with a wallet balance. */
export async function createUser(
  overrides: Partial<{
    id: string
    phone: string
    email: string
    fullName: string
    balance: number
    passwordHash: string
    isAdmin: boolean
    isSuspended: boolean
    role: string
  }> = {}
) {
  return await prisma.user.create({
    data: {
      id: overrides.id,
      phone: overrides.phone ?? '08012345678',
      email: overrides.email ?? null,
      fullName: overrides.fullName ?? 'Test User',
      passwordHash: overrides.passwordHash ?? 'hashed-password',
      balance: overrides.balance ?? 5000,
      isAdmin: overrides.isAdmin ?? false,
      isSuspended: overrides.isSuspended ?? false,
      role: overrides.role ?? 'User',
      referralCode: `REF${Math.floor(Math.random() * 1_000_000)}`,
    },
  })
}

/** Resets and re-seeds the database. */
export async function freshDatabase(): Promise<void> {
  await resetDatabase()
  await seedCatalogue()
}
