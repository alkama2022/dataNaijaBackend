import { getOverview, getYesterdaySales, naira } from '@/lib/admin/analytics'
import { Flash, PageHeader } from '../_components/page-parts'

/**
 * The overview: what the business did today, how the week looks and what
 * needs the admin's attention.
 */
export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: { msg?: string; error?: string }
}) {
  const [overview, yesterday] = await Promise.all([
    getOverview(),
    getYesterdaySales(),
  ])

  const change =
    yesterday === 0
      ? null
      : ((overview.salesToday - yesterday) / yesterday) * 100

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="How the business is doing right now"
      />
      <Flash message={searchParams.msg} error={searchParams.error} />

      <div className="kpis">
        <div className="card">
          <p className="mut">Delivered sales today</p>
          <p className="k">{naira(overview.salesToday)}</p>
          <p className={change !== null && change >= 0 ? 'mut ok' : 'mut'}>
            {change === null
              ? overview.salesToday === 0 && yesterday === 0
                ? 'No sales today or yesterday'
                : 'No sales yesterday'
              : `${change >= 0 ? 'Up' : 'Down'} ${Math.abs(change).toFixed(0)}% on yesterday`}
          </p>
        </div>
        <div className="card">
          <p className="mut">Orders today</p>
          <p className="k">{overview.ordersToday}</p>
          <p className="mut">Delivered, failed and held</p>
        </div>
        <div className="card">
          <p className="mut">Estimated profit today</p>
          <p className="k">
            {overview.profitToday === null
              ? 'Unavailable'
              : naira(overview.profitToday)}
          </p>
          <p className="mut">
            {overview.profitToday === null
              ? `${overview.profitOrdersMissingCost} delivered order(s) missing provider cost data`
              : 'Based on current recorded provider costs'}
          </p>
        </div>
        <div className="card">
          <p className="mut">Success rate</p>
          <p className="k">
            {overview.successRate === null
              ? '—'
              : `${overview.successRate.toFixed(1)}%`}
          </p>
          <p className="mut">
            {overview.successRate === null ? 'No data in the last 24 hours' : 'Last 24 hours'}
          </p>
        </div>
      </div>

      <div className="two">
        <div className="card">
          <h2 style={{ fontSize: 16, fontWeight: 800 }}>Sales, last 7 days</h2>
          <div className="bars">
            {overview.week.map((point) => (
              <div className="bc" key={point.day}>
                <div
                  className="bar"
                  style={{ height: `${Math.max(point.share, 3)}%` }}
                  title={naira(point.amount)}
                />
                <span className="mut" style={{ fontSize: 12 }}>
                  {point.day}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2
            style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}
          >
            Needs attention
          </h2>
          <div className="row sp" style={{ marginBottom: 12 }}>
            <span>
              <b className="k" style={{ fontSize: 24 }}>
                {overview.needsAttention.ordersHeld}
              </b>
              <span className="mut"> orders held for review</span>
            </span>
            <a href="/admin/orders?status=Needs+review">Review</a>
          </div>
          <div className="row sp" style={{ marginBottom: 12 }}>
            <span>
              <b className="k" style={{ fontSize: 24 }}>
                {overview.needsAttention.providersLow}
              </b>
              <span className="mut"> providers low or down</span>
            </span>
            <a className="mut" href="/admin/providers" style={{ fontWeight: 700 }}>
              Check
            </a>
          </div>
          <div className="row sp">
            <span>
              <b className="k" style={{ fontSize: 24 }}>
                {overview.needsAttention.thinMargins}
              </b>
              <span className="mut"> plans with thin margin</span>
            </span>
            <a className="mut" href="/admin/prices" style={{ fontWeight: 700 }}>
              Fix
            </a>
          </div>
        </div>
      </div>
    </>
  )
}
