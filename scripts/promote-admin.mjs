/**
 * Promotes a customer account to an admin so they can sign in to the
 * admin panel.
 *
 *   npm run admin:promote -- 08012345678
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const phone = process.argv[2]

  if (!phone) {
    console.error('Usage: npm run admin:promote -- <phone number>')
    process.exit(1)
  }

  const user = await prisma.user.findUnique({ where: { phone } })
  if (!user) {
    console.error(`No account with the phone number ${phone}.`)
    process.exit(1)
  }

  await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } })
  console.log(`${user.fullName} (${phone}) can now sign in to /admin.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
