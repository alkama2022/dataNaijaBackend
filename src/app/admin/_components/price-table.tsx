'use client'

import { useState } from 'react'
import { savePlanPrices, togglePlanActive } from '../actions'

/**
 * The price table.
 *
 * The design lets the admin edit several prices and publish them together
 * with "Save prices", so the table keeps a draft of the edited values and
 * shows the margin that each edit would produce.
 */

export interface PriceRow {
  planId: string
  name: string
  sellPrice: number
  /** The margin with the current prices, in Naira. */
  margin: number | null
  /** The configured costs for this plan. */
  costs: Array<{ providerId: string; provider: string; cost: number }>
  isActive: boolean
}

export interface PriceProvider {
  id: string
  name: string
  isActive: boolean
  isDown: boolean
  walletBalance: number
}

export function PriceTable({
  rows,
  providers,
}: {
  rows: PriceRow[]
  providers: PriceProvider[]
}) {
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [costs, setCosts] = useState<Record<string, string>>({})

  const sellPriceOf = (row: PriceRow) =>
    prices[row.planId] ?? String(row.sellPrice)

  const costOf = (row: PriceRow, providerId: string) => {
    const key = `${row.planId}:${providerId}`
    const existing = row.costs.find((cost) => cost.providerId === providerId)
    return costs[key] ?? (existing ? String(existing.cost) : '')
  }

  const marginOf = (row: PriceRow) => {
    const price = Number(sellPriceOf(row))
    if (!Number.isSafeInteger(price) || price <= 0) return null
    const eligibleCosts = providers.flatMap((provider) => {
      if (!provider.isActive || provider.isDown) return []
      const rawCost = costOf(row, provider.id)
      if (rawCost === '') return []
      const cost = Number(rawCost)
      if (
        !Number.isSafeInteger(cost) ||
        cost < 0 ||
        provider.walletBalance < cost
      ) {
        return []
      }
      return [cost]
    })
    if (eligibleCosts.length === 0) return null
    const best = Math.min(...eligibleCosts)
    return price - best
  }

  const isDirty = Object.keys(prices).length > 0 || Object.keys(costs).length > 0

  const columns = [
    '1.3fr',
    ...providers.map(() => '78px'),
    '110px',
    '100px',
    '120px',
    '64px',
  ].join(' ')

  return (
    <form action={savePlanPrices}>
      <div className="row sp" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <p className="mut">
          Edit sell prices and provider costs. Margins use the cheapest enabled,
          available provider with enough recorded balance.
        </p>
        <div className="row">
          {isDirty ? <span className="tag">Unsaved changes</span> : null}
          <button className="btn" type="submit" disabled={!isDirty}>
            Save prices
          </button>
        </div>
      </div>

      <div className="card tw">
        <div className="tr th" style={{ gridTemplateColumns: columns }}>
          <span>Plan</span>
          {providers.map((provider) => (
            <span key={provider.id}>{provider.name}</span>
          ))}
          <span>Cheapest eligible</span>
          <span>Sell price</span>
          <span>Margin</span>
          <span>Active</span>
        </div>

        {rows.map((row) => {
          const margin = marginOf(row)
          const best = margin === null ? null : Number(sellPriceOf(row)) - margin

          return (
            <div
              className="tr"
              key={row.planId}
              style={{ gridTemplateColumns: columns }}
            >
              <span>{row.name}</span>

              {providers.map((provider) => {
                const key = `${row.planId}:${provider.id}`
                return (
                  <span key={provider.id}>
                    <input
                      className="f"
                      aria-label={`${provider.name} cost for ${row.name}`}
                      inputMode="numeric"
                      name={`cost:${provider.id}:${row.planId}`}
                      value={costOf(row, provider.id)}
                      onChange={(event) =>
                        setCosts((current) => ({
                          ...current,
                          [key]: event.target.value.replace(/\D/g, '').slice(0, 7),
                        }))
                      }
                    />
                  </span>
                )
              })}

              <span>
                <b>{best === null ? 'None free' : `₦${best}`}</b>
                <br />
                <span className="mut">
                  {best === null ? 'No eligible provider' : 'margin estimate'}
                </span>
              </span>

              <span>
                <input
                  className="f"
                  aria-label={`Sell price for ${row.name}`}
                  inputMode="numeric"
                  name={`price-${row.planId}`}
                  value={sellPriceOf(row)}
                  onChange={(event) =>
                    setPrices((current) => ({
                      ...current,
                      [row.planId]: event.target.value,
                    }))
                  }
                />
              </span>

              <span className={margin === null || margin < 30 ? 'bad' : 'ok'}>
                {margin === null ? '—' : `₦${margin}`}
              </span>

              <span>
                <button
                  className={row.isActive ? 'btn sm ghost' : 'btn sm'}
                  type="submit"
                  formAction={togglePlanActive}
                  name="planId"
                  value={row.planId}
                >
                  {row.isActive ? 'Turn off' : 'Turn on'}
                </button>
              </span>
            </div>
          )
        })}

        {rows.length === 0 ? (
          <p className="mut empty">No plans yet. Add one below.</p>
        ) : null}
      </div>
    </form>
  )
}
