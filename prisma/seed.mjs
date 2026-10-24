/**
 * Seeds the networks, the data bundle catalogue, the providers and the
 * first admin account.
 *
 * The bundle catalogue is what the Auto-Buy scheduler re-checks before
 * every purchase, and the provider costs are what the admin panel works
 * the margin out from, so both have to exist.
 *
 *   npm run db:seed
 *
 * Set ADMIN_PHONE and ADMIN_PASSWORD to create the first admin account.
 */

import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const NETWORKS = [
  {
    name: 'MTN',
    abbreviation: 'MTN',
    bgColor: '#FFCC00',
    fgColor: '#10231A',
  },
  { name: 'Airtel', abbreviation: 'Ai', bgColor: '#E40000', fgColor: '#FFFFFF' },
  { name: 'Glo', abbreviation: 'glo', bgColor: '#17A34A', fgColor: '#FFFFFF' },
  {
    name: '9mobile',
    abbreviation: '9m',
    bgColor: '#1F2937',
    fgColor: '#B7F34A',
  },
]

/** The bundle catalogue, mirrored from the Flutter `MockData`. */
const PLANS = [
  {
    type: 'SME',
    plans: [
      ['500MB', '30 Days', 160, false],
      ['1GB', '30 Days', 300, false],
      ['2GB', '30 Days', 600, false],
      ['5GB', '30 Days', 1500, false],
      ['10GB', '30 Days', 3000, false],
    ],
  },
  {
    type: 'SME2',
    plans: [
      ['1GB', '30 Days', 310, false],
      ['2GB', '30 Days', 620, false],
      ['5GB', '30 Days', 1550, false],
      ['10GB', '30 Days', 3100, false],
    ],
  },
  {
    type: 'Gifting',
    plans: [
      ['1GB', '30 Days', 350, false],
      ['2GB', '30 Days', 700, false],
      ['5GB', '30 Days', 1750, false],
    ],
  },
  {
    type: 'Corporate Gifting',
    plans: [
      ['2GB', '30 Days', 590, false],
      ['5GB', '30 Days', 1450, false],
      ['10GB', '30 Days', 2900, false],
      ['20GB', '30 Days', 5800, false],
    ],
  },
  {
    type: 'Awoof',
    plans: [
      ['1.5GB', '2 Days', 250, true],
      ['3GB', '7 Days', 500, true],
      ['7GB', '7 Days', 1000, true],
    ],
  },
]

/**
 * The upstream suppliers, with the share of the sell price they charge.
 * The three factors mirror the margins in the design mockup.
 */
const PROVIDERS = [
  { name: 'Toppa', factor: 0.72, walletBalance: 84_200 },
  { name: 'SMEData', factor: 0.82, walletBalance: 9_800 },
  { name: 'Bigisub', factor: 0.75, walletBalance: 42_000 },
]

async function seedNetworksAndPlans() {
  for (const network of NETWORKS) {
    const saved = await prisma.network.upsert({
      where: { id: network.name },
      create: {
        id: network.name,
        name: network.name,
        abbreviation: network.abbreviation,
        bgColor: network.bgColor,
        fgColor: network.fgColor,
        isActive: true,
      },
      update: {
        abbreviation: network.abbreviation,
        bgColor: network.bgColor,
        fgColor: network.fgColor,
      },
    })

    for (const group of PLANS) {
      for (const [gb, days, price, hot] of group.plans) {
        await prisma.dataPlan.upsert({
          where: { id: `${saved.id}-${group.type}-${gb}-${days}` },
          create: {
            id: `${saved.id}-${group.type}-${gb}-${days}`,
            networkId: saved.id,
            type: group.type,
            gb,
            days,
            price,
            isHot: hot,
            isActive: true,
          },
          update: { price, isHot: hot },
        })
      }
    }
  }
}

async function seedProviders() {
  for (const provider of PROVIDERS) {
    await prisma.provider.upsert({
      where: { name: provider.name },
      create: {
        name: provider.name,
        isActive: true,
        isDown: false,
        walletBalance: provider.walletBalance,
        uptimePercent: 99,
      },
      update: { walletBalance: provider.walletBalance },
    })
  }

  // What each provider charges for each plan.
  const plans = await prisma.dataPlan.findMany()
  const providers = await prisma.provider.findMany()

  for (const plan of plans) {
    for (const provider of providers) {
      const factor =
        PROVIDERS.find((entry) => entry.name === provider.name)?.factor ?? 0.8
      await prisma.providerPlanCost.upsert({
        where: {
          providerId_planId: { providerId: provider.id, planId: plan.id },
        },
        create: {
          providerId: provider.id,
          planId: plan.id,
          cost: Math.round(plan.price * factor),
        },
        update: { cost: Math.round(plan.price * factor) },
      })
    }
  }
}

/**
 * Creates the first admin when ADMIN_PHONE and ADMIN_PASSWORD are set.
 * Without them the seed leaves the admin accounts alone.
 */
async function seedAdmin() {
  const phone = process.env.ADMIN_PHONE
  const password = process.env.ADMIN_PASSWORD
  if (!phone || !password) {
    console.log('Set ADMIN_PHONE and ADMIN_PASSWORD to create the first admin.')
    return
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const existing = await prisma.user.findUnique({ where: { phone } })

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { isAdmin: true, passwordHash },
    })
    console.log(`Promoted ${phone} to admin.`)
    return
  }

  await prisma.user.create({
    data: {
      phone,
      passwordHash,
      fullName: 'Admin',
      isAdmin: true,
      balance: 0,
      referralCode: `ADM${Math.floor(1000 + Math.random() * 9000)}`,
    },
  })
  console.log(`Created admin ${phone}.`)
}

async function main() {
  await seedNetworksAndPlans()
  await seedProviders()
  await seedAdmin()
  console.log('Seeded networks, data plans and providers.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
