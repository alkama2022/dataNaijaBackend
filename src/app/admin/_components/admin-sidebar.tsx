'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOutAction } from '../actions'

/**
 * The admin sidebar.
 *
 * It is a client component because the active tab comes from the current
 * path. The badge counts are read on the server and passed in.
 */

export interface AdminNavItem {
  href: string
  label: string
  badge?: number
}

export function AdminSidebar({
  items,
  adminName,
}: {
  items: AdminNavItem[]
  adminName: string
}) {
  const pathname = usePathname()

  return (
    <nav className="side" aria-label="Admin">
      <div className="logo">
        <span className="lg" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
            <path d="M13 3l-8 11h6l-1 7 8-11h-6z" />
          </svg>
        </span>
        DataNaija
      </div>

      {items.map((item) => {
        const isActive =
          item.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={isActive ? 'nv on' : 'nv'}
          >
            <span>{item.label}</span>
            {item.badge ? <span className="bd">{item.badge}</span> : null}
          </Link>
        )
      })}

      <div className="side-foot">
        Signed in as {adminName}
        <form action={signOutAction}>
          <button className="btn sm ghost" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </nav>
  )
}
