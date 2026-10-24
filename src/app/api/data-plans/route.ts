import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * List active data plans.
 * Query params: ?network=MTN&type=SME
 * Flutter uses these to populate the bundle selection screen.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const network = searchParams.get('network')
    const type = searchParams.get('type')

    const plans = await prisma.dataPlan.findMany({
      where: {
        isActive: true,
        ...(network ? { network: { name: network } } : {}),
        ...(type ? { type } : {}),
      },
      include: {
        network: {
          select: { name: true, abbreviation: true, bgColor: true, fgColor: true },
        },
      },
      orderBy: { price: 'asc' },
    })

    return NextResponse.json(plans)
  } catch (error) {
    console.error('Data plans error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
