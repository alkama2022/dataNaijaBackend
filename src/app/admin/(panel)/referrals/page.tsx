import { getPlanMargins, getReferralRows, naira } from '@/lib/admin/analytics'
import { getSettings, settingNumber } from '@/lib/admin/settings'
import { Flash, Note, PageHeader } from '../../_components/page-parts'
import { saveReferralSettings } from '../../actions'

/**
 * The Referrals tab: the commission rules, a worked example of what a
 * referral earns and the top referrers.
 */
export default async function AdminReferralsPage({
  searchParams,
}: {
  searchParams: { msg?: string; error?: string }
}) {
  const [settings, referrers, plans] = await Promise.all([
    getSettings(),
    getReferralRows(),
    getPlanMargins(),
  ])

  const enabled = settings['referral.enabled'] === '1'
  const firstBonus = settingNumber(settings, 'referral.firstBonus', 100)
  const commissionPct = Math.min(
    settingNumber(settings, 'referral.commissionPct', 20),
    100
  )
  const example = plans[0]

  // The commission comes out of the profit, never out of the sale amount.
  const exampleProfit = example?.margin !== null && example?.margin !== undefined
    ? Math.max(example.margin, 0)
    : 0
  const exampleCommission = Math.floor(exampleProfit * (commissionPct / 100))
  const exampleKept = exampleProfit - exampleCommission
  const warning =
    firstBonus > exampleProfit
      ? 'The first-purchase bonus is larger than the profit on this sale. That is a one-time cost to win a customer.'
      : ''

  const lifetimes = ['Lifetime', '12 months', '6 months']
  const audiences = ['Everyone', 'Agents only']

  return (
    <>
      <PageHeader
        title="Referrals"
        subtitle="Control how friends earn bonuses for your customers"
      />
      <Flash message={searchParams.msg} error={searchParams.error} />

      <Note>
        Referral history and balances are read from saved records. The reward
        settings below are configuration only and are not yet applied by the
        customer purchase flow.
      </Note>

      <div className="two">
        <div className="card">
          <form action={saveReferralSettings}>
            <div className="row sp">
              <h2 style={{ fontSize: 17, fontWeight: 800 }}>
                Referral program
              </h2>
              <label className="row" style={{ fontSize: 13, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={enabled}
                />
                Enabled
              </label>
            </div>

            <div className="fgrid" style={{ marginTop: 14 }}>
              <div>
                <label className="lb" htmlFor="firstBonus">
                  First-purchase bonus (₦)
                </label>
                <input
                  id="firstBonus"
                  name="firstBonus"
                  className="f"
                  inputMode="numeric"
                  defaultValue={settings['referral.firstBonus']}
                />
                <p className="mut" style={{ fontSize: 12, marginTop: 4 }}>
                  Paid once when a friend makes their first purchase
                </p>
              </div>

              <div>
                <label className="lb" htmlFor="commissionPct">
                  Commission (% of your profit)
                </label>
                <input
                  id="commissionPct"
                  name="commissionPct"
                  className="f"
                  inputMode="numeric"
                  defaultValue={settings['referral.commissionPct']}
                />
                <p className="mut" style={{ fontSize: 12, marginTop: 4 }}>
                  Paid on every later purchase
                </p>
              </div>

              <div>
                <label className="lb" htmlFor="monthlyCap">
                  Monthly cap per referrer (₦)
                </label>
                <input
                  id="monthlyCap"
                  name="monthlyCap"
                  className="f"
                  inputMode="numeric"
                  defaultValue={settings['referral.monthlyCap']}
                />
                <p className="mut" style={{ fontSize: 12, marginTop: 4 }}>
                  0 means no cap
                </p>
              </div>

              <div>
                <label className="lb" htmlFor="minToWithdraw">
                  Minimum to move to wallet (₦)
                </label>
                <input
                  id="minToWithdraw"
                  name="minToWithdraw"
                  className="f"
                  inputMode="numeric"
                  defaultValue={settings['referral.minToWithdraw']}
                />
                <p className="mut" style={{ fontSize: 12, marginTop: 4 }}>
                  Smaller balances stay in the bonus wallet
                </p>
              </div>
            </div>

            <p className="lb" style={{ marginTop: 16 }}>
              How long a friend earns commission for you
            </p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {lifetimes.map((lifetime) => (
                <label key={lifetime} className="row">
                  <input
                    type="radio"
                    name="lifetime"
                    value={lifetime}
                    defaultChecked={settings['referral.lifetime'] === lifetime}
                  />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    {lifetime}
                  </span>
                </label>
              ))}
            </div>

            <p className="lb" style={{ marginTop: 16 }}>
              Who can earn
            </p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {audiences.map((audience) => (
                <label key={audience} className="row">
                  <input
                    type="radio"
                    name="whoCanEarn"
                    value={audience}
                    defaultChecked={
                      settings['referral.whoCanEarn'] === audience
                    }
                  />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    {audience}
                  </span>
                </label>
              ))}
            </div>

            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn" type="submit">
                Save referral settings
              </button>
            </div>
          </form>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 17, fontWeight: 800 }}>
            Configured example (not applied)
          </h2>
          <p className="mut" style={{ marginTop: 2 }}>
            {example
              ? `${example.name} at ${naira(example.sellPrice)}, lowest eligible configured cost ${
                  example.bestCost === null ? '-' : naira(example.bestCost)
                }`
              : 'No plans yet.'}
          </p>

          <p className="mut" style={{ marginTop: 12 }}>
            Estimated margin before referral rewards
          </p>
          <p className="k">{naira(exampleProfit)}</p>

          <p className="mut" style={{ marginTop: 12 }}>
            Example commission
          </p>
          <p className="k ok">{naira(exampleCommission)}</p>

          <p className="mut" style={{ marginTop: 12 }}>
            Remaining estimate {naira(exampleKept)}. Configured first-purchase
            bonus: {naira(firstBonus)}.
          </p>

          {warning ? (
            <p className="bad" style={{ marginTop: 10, fontSize: 13, fontWeight: 700 }}>
              {warning}
            </p>
          ) : null}
        </div>
      </div>

      <div className="card tw" style={{ marginTop: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>
          Top referrers
        </h2>
        <div className="tr th g5">
          <span>Referrer</span>
          <span>Friends</span>
          <span>Total earned</span>
          <span>Account</span>
          <span>Note</span>
        </div>
        {referrers.map((referrer) => (
          <div className="tr g5" key={referrer.id}>
            <span>{referrer.name}</span>
            <span>{referrer.friends}</span>
            <span>{naira(referrer.earned)}</span>
            <span>
              <span className={referrer.statusClass}>{referrer.status}</span>
            </span>
            <span>
              <span className="mut" style={{ fontSize: 12 }}>
                {referrer.isActive
                  ? 'Account is active'
                  : 'Account is suspended'}
              </span>
            </span>
          </div>
        ))}
        {referrers.length === 0 ? (
          <p className="mut empty">No referrals yet.</p>
        ) : null}
      </div>
    </>
  )
}
