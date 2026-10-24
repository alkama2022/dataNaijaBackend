import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * List active mobile networks.
 * Flutter displays these as selectable chips on the Buy Data screen.
 */
export async function GET() {
  try {
    const networks = await prisma.network.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json(networks)
  } catch (error) {
    console.error('Networks error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
