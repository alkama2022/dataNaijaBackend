import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin/session'
import { AdminSidebar, type AdminNavItem } from '../_components/admin-sidebar'

/**
 * The signed-in part of the admin panel.
 *
 * The sign-in page sits outside this layout, so the guard can send
 * unauthenticated visitors to `/admin/signin` without looping.
 */
export default async function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const admin = await requireAdmin()

  // The badge counts are what the admin has to look at: orders held for
  // review, providers that need attention and Auto-Buy rules that are
  // failing.
  const [ordersHeld, providersLow, autoBuyAttention] = await Promise.all([
    prisma.transaction.count({
      where: { typeKey: 'd', status: 'Pending', autoBuyScheduleId: null },
    }),
    prisma.provider.count({
      where: {
        OR: [
          { isDown: true },
          { isActive: false },
          { walletBalance: { lt: 10_000 } },
        ],
      },
    }),
    prisma.autoBuySchedule.count({ where: { consecutiveFailures: { gt: 0 } } }),
  ])

  const items: AdminNavItem[] = [
    { href: '/admin', label: 'Overview' },
    { href: '/admin/prices', label: 'Prices' },
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/orders', label: 'Orders', badge: ordersHeld },
    { href: '/admin/auto-buy', label: 'Auto-Buy', badge: autoBuyAttention },
    { href: '/admin/providers', label: 'Providers', badge: providersLow },
    { href: '/admin/referrals', label: 'Referrals' },
    { href: '/admin/payments', label: 'Payment methods' },
  ]

  return (
    <div className="ad">
      <AdminSidebar items={items} adminName={admin.fullName} />
      <main className="main">{children}</main>
    </div>
  )
}
