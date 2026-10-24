import Link from 'next/link'
import { getAutoBuyRows } from '@/lib/admin/analytics'
import { Flash, Note, PageHeader } from '../../_components/page-parts'
import { toggleAutoBuy } from '../../actions'

/**
 * The Auto-Buy tab: the automatic purchase rules customers created, and
 * what the scheduler is doing with them.
 */
export default async function AdminAutoBuyPage({
  searchParams,
}: {
  searchParams: { msg?: string; error?: string; status?: string }
}) {
  const status = searchParams.status ?? 'All'
  const all = await getAutoBuyRows()

  const rows = all.filter((row) => {
    if (status === 'Active') return row.isActive
    if (status === 'Paused') return !row.isActive
    if (status === 'Needs attention') return row.failures > 0
    return true
  })

  const filters = ['All', 'Active', 'Paused', 'Needs attention']

  return (
    <>
      <PageHeader
        title="Auto-Buy"
        subtitle="Automatic purchase rules created by customers"
      />
      <Flash message={searchParams.msg} error={searchParams.error} />

      <Note>
        Auto-Buy rules are created by customers in the app. The server buys
        the bundle on their schedule and takes the money from their wallet,
        even when their phone is off. A rule is paused after three failed
        attempts so a customer is never charged unexpectedly.
      </Note>

      <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {filters.map((filter) => (
          <Link
            key={filter}
            href={`/admin/auto-buy?status=${encodeURIComponent(filter)}`}
            className={status === filter ? 'chip on' : 'chip'}
          >
            {filter}
          </Link>
        ))}
      </div>

      <div className="card tw">
        <div className="tr th g6">
          <span>Customer</span>
          <span>Bundle</span>
          <span>Schedule</span>
          <span>Next purchase</span>
          <span>Status</span>
          <span>Action</span>
        </div>

        {rows.map((row) => (
          <div className="tr g6" key={row.id}>
            <span>
              {row.customer}
              <br />
              <span className="mut">{row.phone}</span>
            </span>
            <span>
              {row.plan}
              <br />
              <span className="mut">
                ₦{row.amount.toLocaleString('en-NG')} each
              </span>
            </span>
            <span>{row.frequency}</span>
            <span>{row.nextRun}</span>
            <span>
              <span className={row.statusClass}>{row.status}</span>
              <br />
              <span className="mut">
                {row.failures > 0
                  ? `${row.failures} failed attempt${
                      row.failures === 1 ? '' : 's'
                    }`
                  : 'No failures'}
              </span>
            </span>
            <span>
              <form action={toggleAutoBuy}>
                <input type="hidden" name="scheduleId" value={row.id} />
                <input
                  type="hidden"
                  name="status"
                  value={row.isActive ? 'Paused' : 'Active'}
                />
                <button
                  className={row.isActive ? 'btn sm dng' : 'btn sm'}
                  type="submit"
                >
                  {row.isActive ? 'Pause' : 'Resume'}
                </button>
              </form>
            </span>
          </div>
        ))}

        {rows.length === 0 ? (
          <p className="mut empty">No Auto-Buy rules match.</p>
        ) : null}
      </div>
    </>
  )
}
