/**
 * Runs after the test framework is installed.
 *
 * Releases the Prisma connection pool when the file is done so the next
 * suite starts with a clean connection.
 */
afterAll(async () => {
  const { prisma } = await import('@/lib/prisma')
  await prisma.$disconnect()
})
