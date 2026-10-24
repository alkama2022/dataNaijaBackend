import Link from 'next/link'
import { getUserRows } from '@/lib/admin/analytics'
import { Flash, PageHeader } from '../../_components/page-parts'
import { toggleUserSuspension } from '../../actions'

/**
 * The Users tab: the customer list with their wallet, their order count
 * and a way to suspend or reactivate them.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: { msg?: string; error?: string; q?: string; status?: string }
}) {
  const search = searchParams.q ?? ''
  const status = searchParams.status ?? 'All'
  const rows = await getUserRows(search, status)

  const filters = ['All', 'Active', 'Suspended']

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Manage customers and agents"
      />
      <Flash message={searchParams.msg} error={searchParams.error} />

      <form
        method="get"
        className="row"
        style={{ marginBottom: 14, flexWrap: 'wrap' }}
      >
        <input
          className="f"
          style={{ maxWidth: 300 }}
          aria-label="Search users"
          placeholder="Search name or phone"
          name="q"
          defaultValue={search}
        />
        {filters.map((filter) => (
          <Link
            key={filter}
            href={`/admin/users?status=${encodeURIComponent(filter)}${
              search ? `&q=${encodeURIComponent(search)}` : ''
            }`}
            className={status === filter ? 'chip on' : 'chip'}
          >
            {filter}
          </Link>
        ))}
        <button className="btn sm ghost" type="submit">
          Search
        </button>
      </form>

      <div className="card tw">
        <div className="tr th g2">
          <span>User</span>
          <span>Wallet</span>
          <span>Orders</span>
          <span>Type</span>
          <span>Status</span>
          <span>Action</span>
        </div>

        {rows.map((user) => (
          <div className="tr g2" key={user.id}>
            <span>
              {user.name}
              <br />
              <span className="mut">{user.phone}</span>
            </span>
            <span>₦{user.wallet.toLocaleString('en-NG')}</span>
            <span>{user.orders}</span>
            <span>
              <span className="pill p-n">{user.role}</span>
            </span>
            <span>
              <span className={user.statusClass}>{user.status}</span>
            </span>
            <span>
              <form action={toggleUserSuspension}>
                <input type="hidden" name="userId" value={user.id} />
                <button
                  className={user.isSuspended ? 'btn sm' : 'btn sm dng'}
                  type="submit"
                >
                  {user.isSuspended ? 'Reactivate' : 'Suspend'}
                </button>
              </form>
            </span>
          </div>
        ))}

        {rows.length === 0 ? (
          <p className="mut empty">No users match.</p>
        ) : null}
      </div>
    </>
  )
}
