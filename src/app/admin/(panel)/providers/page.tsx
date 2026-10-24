import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import {
  getProviderHealth,
  getProviderRanking,
  naira,
} from '@/lib/admin/analytics'
import { getSettings, settingNumber } from '@/lib/admin/settings'
import { Flash, Note, PageHeader } from '../../_components/page-parts'
import {
  saveRoutingSettings,
  toggleProviderActive,
  toggleProviderOutage,
  recordProviderBalance,
} from '../../actions'

/**
 * The Providers tab: who takes an order, how healthy they are and how the
 * routing rules are set up.
 */
export default async function AdminProvidersPage({
  searchParams,
}: {
  searchParams: { msg?: string; error?: string; plan?: string }
}) {
  const [health, plans, settings] = await Promise.all([
    getProviderHealth(),
    prisma.dataPlan.findMany({
      include: { network: { select: { name: true } } },
      orderBy: { price: 'asc' },
    }),
    getSettings(),
  ])

  const selectedPlanId = searchParams.plan ?? plans[0]?.id ?? ''
  const ranking = selectedPlanId
    ? await getProviderRanking(selectedPlanId)
    : { planName: '', ranked: [] }

  const smart = settings['routing.mode'] !== 'cheap'
  const weights = {
    price: settingNumber(settings, 'routing.weight.price', 40),
    reliability: settingNumber(settings, 'routing.weight.reliability', 30),
    fault: settingNumber(settings, 'routing.weight.fault', 20),
    availability: settingNumber(settings, 'routing.weight.availability', 10),
  }

  const weightFields = [
    {
      name: 'weightPrice',
      key: 'price' as const,
      label: 'Price',
      hint: 'Lower cost scores higher',
    },
    {
      name: 'weightReliability',
      key: 'reliability' as const,
      label: 'Reliability',
      hint: 'Delivery success, last 7 days',
    },
    {
      name: 'weightFault',
      key: 'fault' as const,
      label: 'Fault rate',
      hint: 'Errors and timeouts, last 24 hours',
    },
    {
      name: 'weightAvailability',
      key: 'availability' as const,
      label: 'Availability',
      hint: 'Uptime from health checks',
    },
  ]

  return (
    <>
      <PageHeader
        title="Providers"
        subtitle="Smart routing and data supplier health"
      />
      <Flash message={searchParams.msg} error={searchParams.error} />
      <Note>
        This page stores provider routing preferences and balance estimates.
        Purchases are not yet connected to provider routing, and no live provider
        health checks are configured.
      </Note>

      <div className="two">
        <div className="card">
          <h2 style={{ fontSize: 17, fontWeight: 800 }}>Smart routing</h2>

          <p className="mut" style={{ margin: '6px 0 10px' }}>
            {smart
              ? 'Preview scores compare configured cost, recorded delivery history, and configured uptime. Providers that are off, marked down, or short of recorded balance are excluded.'
              : 'The preview ranks eligible providers by configured cost, using recorded delivery reliability to break ties.'}
          </p>
          <p className="mut" style={{ fontSize: 12, marginBottom: 10 }}>
            Delivery history comes from recorded provider assignments; orders
            without a provider ID are not included.
          </p>

          <form action={saveRoutingSettings}>
            <p className="lb">How orders are routed</p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {(
                [
                  ['smart', 'Smart score'],
                  ['cheap', 'Cheapest only'],
                ] as const
              ).map(([mode, label]) => (
                <label key={mode} className="row">
                  <input
                    type="radio"
                    name="mode"
                    value={mode}
                    defaultChecked={settings['routing.mode'] === mode}
                  />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{label}</span>
                </label>
              ))}
            </div>

            <div className="fgrid" style={{ margin: '14px 0 8px' }}>
              {weightFields.map((field) => (
                <div key={field.name}>
                  <div className="row sp">
                    <label className="lb" htmlFor={field.name}>
                      {field.label}
                    </label>
                    <b>{weights[field.key]}</b>
                  </div>
                  <input
                    id={field.name}
                    type="range"
                    min="0"
                    max="100"
                    name={field.name}
                    defaultValue={weights[field.key]}
                  />
                  <p className="mut" style={{ fontSize: 12 }}>
                    {field.hint}
                  </p>
                </div>
              ))}
            </div>

            <div className="row">
              <button className="btn" type="submit">
                Save routing rules
              </button>
            </div>
          </form>

          <h2 style={{ fontSize: 15, fontWeight: 800, margin: '14px 0 4px' }}>
            Order of providers for {ranking.planName}
          </h2>

          {ranking.ranked.map((provider, index) => (
            <div className="rk" key={provider.providerId}>
              <span>#{index + 1}</span>
              <span>{provider.name}</span>
              <span>{naira(provider.cost)}</span>
              <span className="row">
                <span className="sb" style={{ flex: 1 }}>
                  <i
                    style={{
                      width: smart
                        ? `${Math.round(provider.score * 100)}%`
                        : `${Math.round(
                            (ranking.ranked[ranking.ranked.length - 1].cost /
                              provider.cost) *
                              100
                          )}%`,
                    }}
                  />
                </span>
                <span className="mut">
                  {smart
                    ? provider.score.toFixed(2)
                    : `${provider.reliability.toFixed(0)}%`}
                </span>
              </span>
            </div>
          ))}

          {ranking.ranked.length === 0 ? (
            <p className="bad" style={{ fontWeight: 700, padding: '8px 0' }}>
              No provider can take this plan right now.
            </p>
          ) : null}

          <p className="mut" style={{ marginTop: 10 }}>
            This ranking is a preview only until the purchase flow is
            connected. The current purchase API does not route orders through
            these providers.
          </p>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 17, fontWeight: 800, marginBottom: 6 }}>
            Plan to rank
          </h2>
          <p className="mut">Pick the plan to see who would take an order.</p>
          <div className="row wrap" style={{ marginTop: 12 }}>
            {plans.map((plan) => (
              <Link
                key={plan.id}
                href={`/admin/providers?plan=${plan.id}`}
                className={plan.id === selectedPlanId ? 'chip on' : 'chip'}
              >
                {plan.network.name} {plan.gb}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="kpis" style={{ marginTop: 18 }}>
        {health.map((provider) => (
          <div className="card" key={provider.id}>
            <div className="row sp">
              <h2 style={{ fontSize: 17, fontWeight: 800 }}>{provider.name}</h2>
              <form action={toggleProviderActive}>
                <input type="hidden" name="providerId" value={provider.id} />
                <button
                  className={provider.isActive ? 'sw on' : 'sw'}
                  aria-label={`Switch ${provider.name} on or off`}
                  type="submit"
                />
              </form>
            </div>

            <p style={{ marginTop: 6 }}>
              <span className={provider.stateClass}>{provider.state}</span>
            </p>

            <p className="mut" style={{ marginTop: 12 }}>
              Wallet balance
            </p>
            <p className={`k ${provider.walletBalance < 10_000 ? 'bad' : 'ok'}`}>
              {naira(provider.walletBalance)}
            </p>
            <p className={`mut ${provider.walletBalance < 10_000 ? 'bad' : 'ok'}`}>
              {provider.balanceWarning}
            </p>

            <div className="m4">
              <div>
                <span>Reliability (7 days)</span>
                {provider.weekOrders
                  ? `${provider.reliability.toFixed(1)}% (${provider.weekOrders} orders)`
                  : 'No routed orders'}
              </div>
              <div>
                <span>Fault rate (24 hours)</span>
                {provider.dayOrders
                  ? `${provider.faultRate.toFixed(1)}% (${provider.dayOrders} orders)`
                  : 'No routed orders'}
              </div>
              <div>
                <span>Configured uptime</span>
                {provider.availability.toFixed(1)}%
              </div>
              <div>
                <span>Last failure</span>
                {provider.lastFailure
                  ? new Date(provider.lastFailure).toLocaleDateString('en-NG')
                  : 'None'}
              </div>
            </div>

            <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <form action={recordProviderBalance} className="row">
                <input type="hidden" name="providerId" value={provider.id} />
                <input
                  className="f"
                  style={{ width: 120 }}
                  name="amount"
                  inputMode="numeric"
                  placeholder="Amount already funded"
                  aria-label={`Record wallet balance change for ${provider.name}`}
                />
                <button className="btn sm ghost" type="submit">
                  Record top-up
                </button>
              </form>
              <form action={toggleProviderOutage}>
                <input type="hidden" name="providerId" value={provider.id} />
                <button className="btn sm ghost" type="submit">
                  {provider.isDown ? 'Mark available' : 'Mark unavailable'}
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
