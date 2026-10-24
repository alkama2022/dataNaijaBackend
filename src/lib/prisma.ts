import { PrismaClient } from '@prisma/client'

// Prevent multiple PrismaClient instances during hot reloads in development.
// This is a standard Next.js pattern; without it, every file save creates a
// new database connection pool which can exhaust connections.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
