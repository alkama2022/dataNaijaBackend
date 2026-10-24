import Link from 'next/link'
import { getOrderRows } from '@/lib/admin/analytics'
import { Flash, Note, PageHeader } from '../../_components/page-parts'
import { markOrderDelivered, refundOrder } from '../../actions'

/**
 * The Orders tab: the data orders, the ones held for review and the ones
 * that failed.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: { msg?: string; error?: string; status?: string }
}) {
  const status = searchParams.status ?? 'All'
  const rows = await getOrderRows(status)

  const filters = ['All', 'Needs review', 'Failed', 'Delivered']

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Failed orders and orders held for review"
      />
      <Flash message={searchParams.msg} error={searchParams.error} />

      <Note>
        Orders held for review had an unclear answer from the provider. Check
        with the provider first, then mark delivered or refund, so the customer
        is never sent data twice.
      </Note>

      <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {filters.map((filter) => (
          <Link
            key={filter}
            href={`/admin/orders?status=${encodeURIComponent(filter)}`}
            className={status === filter ? 'chip on' : 'chip'}
          >
            {filter}
          </Link>
        ))}
      </div>

      <div className="card tw">
        <div className="tr th g3">
          <span>Order</span>
          <span>Customer</span>
          <span>Plan and number</span>
          <span>Amount</span>
          <span>Provider</span>
          <span>Status</span>
          <span>Action</span>
        </div>

        {rows.map((order) => (
          <div className="tr g3" key={order.id}>
            <span>
              {order.ref}
              <br />
              <span className="mut">
                {new Date(order.when).toLocaleString('en-NG', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            </span>
            <span>{order.customer}</span>
            <span>
              {order.plan}
              <br />
              <span className="mut">{order.phone}</span>
            </span>
            <span>₦{order.amount.toLocaleString('en-NG')}</span>
            <span>{order.provider}</span>
            <span>
              <span className={order.statusClass}>{order.status}</span>
            </span>
            <span className="row">
              {order.needsReview ? (
                <>
                  <form action={markOrderDelivered}>
                    <input
                      type="hidden"
                      name="transactionId"
                      value={order.id}
                    />
                    <button className="btn sm" type="submit">
                      Mark delivered
                    </button>
                  </form>
                  <form action={refundOrder}>
                    <input
                      type="hidden"
                      name="transactionId"
                      value={order.id}
                    />
                    <button className="btn sm dng" type="submit">
                      Refund
                    </button>
                  </form>
                </>
              ) : null}
            </span>
          </div>
        ))}

        {rows.length === 0 ? (
          <p className="mut empty">Nothing here.</p>
        ) : null}
      </div>
    </>
  )
}
