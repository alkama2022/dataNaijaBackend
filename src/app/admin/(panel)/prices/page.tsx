import { prisma } from '@/lib/prisma'
import { getPlanMargins } from '@/lib/admin/analytics'
import { Flash, PageHeader } from '../../_components/page-parts'
import { PriceTable } from '../../_components/price-table'
import { addPlan } from '../../actions'

/**
 * The Prices tab: the plans we sell, what each provider charges for them
 * and the margin that leaves.
 */
export default async function AdminPricesPage({
  searchParams,
}: {
  searchParams: { msg?: string; error?: string }
}) {
  const [plans, providers, networks] = await Promise.all([
    getPlanMargins(),
    prisma.provider.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        isDown: true,
        walletBalance: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.network.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
  ])

  const dataTypes = ['SME', 'SME2', 'Gifting', 'Corporate Gifting', 'Awoof']

  return (
    <>
      <PageHeader
        title="Prices"
        subtitle="Add plans, set what you sell for and watch your margin"
      />
      <Flash message={searchParams.msg} error={searchParams.error} />

      <details className="card" style={{ marginBottom: 14 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800, fontSize: 17 }}>
          Add a plan
        </summary>
        <p className="mut" style={{ marginTop: 6 }}>
          Leave a provider cost empty if that provider does not sell this plan.
        </p>

        <form action={addPlan} className="fgrid" style={{ marginTop: 12 }}>
          <div>
            <label className="lb" htmlFor="network">
              Network
            </label>
            <select id="network" name="network" className="f" required>
              {networks.map((network) => (
                <option key={network.name} value={network.name}>
                  {network.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="lb" htmlFor="type">
              Data type
            </label>
            <select id="type" name="type" className="f" required>
              {dataTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="lb" htmlFor="size">
              Plan size
            </label>
            <input
              id="size"
              name="size"
              className="f"
              placeholder="2GB"
              required
            />
          </div>
          <div>
            <label className="lb" htmlFor="sellPrice">
              Your sell price (₦)
            </label>
            <input
              id="sellPrice"
              name="sellPrice"
              className="f"
              inputMode="numeric"
              defaultValue="300"
              required
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button className="btn" type="submit">
              Add plan
            </button>
          </div>
        </form>
      </details>

      <PriceTable
        providers={providers}
        rows={plans.map((plan) => ({
          planId: plan.planId,
          name: plan.name,
          sellPrice: plan.sellPrice,
          margin: plan.margin,
          costs: plan.costs,
          isActive: plan.isActive,
        }))}
      />

      <p className="mut" style={{ marginTop: 12 }}>
        Margins use the cheapest configured eligible provider, but current
        purchases are not connected to provider routing. Historical provider
        costs are not versioned, so profit figures are estimates.
      </p>
    </>
  )
}
