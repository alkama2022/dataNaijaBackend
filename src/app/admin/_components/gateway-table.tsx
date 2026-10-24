'use client'

import { useState } from 'react'
import {
  gatewayFee,
  type PaymentGateway,
} from '@/lib/admin/payment-gateways'

/**
 * The payment gateway comparison.
 *
 * The amount and the VAT switch change the fee, so the table is a client
 * component. The gateway data itself comes from the server.
 */
export function GatewayTable({
  gateways,
}: {
  gateways: PaymentGateway[]
}) {
  const [amount, setAmount] = useState('1000')
  const [includeVat, setIncludeVat] = useState(false)
  const numericAmount = Number(amount)
  const validAmount =
    /^\d+$/.test(amount) &&
    Number.isSafeInteger(numericAmount) &&
    numericAmount > 0 &&
    numericAmount <= 1_000_000_000

  const withFees = gateways
    .map((gateway) => ({
      gateway,
      fee:
        validAmount && gateway.transferRate !== null
          ? gatewayFee(gateway, numericAmount, includeVat)
          : null,
    }))
    .sort((a, b) => (a.fee ?? Infinity) - (b.fee ?? Infinity))

  const cheapestConfirmedFee = withFees
    .filter(({ gateway, fee }) => fee !== null && !gateway.estimated)
    .reduce<number | null>(
      (lowest, row) =>
        lowest === null ? row.fee : Math.min(lowest, row.fee as number),
      null
    )

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div style={{ width: 220 }}>
            <label className="lb" htmlFor="amount">
              Wallet top-up amount (₦)
            </label>
            <input
              id="amount"
              className="f"
              inputMode="numeric"
              aria-describedby="payment-amount-help"
              value={amount}
              onChange={(event) =>
                setAmount(event.target.value.replace(/\D/g, '').slice(0, 10))
              }
            />
            <span id="payment-amount-help" className="mut">
              Enter a whole amount up to ₦1,000,000,000.
            </span>
          </div>

          <label className="row" style={{ marginTop: 18 }}>
            <input
              type="checkbox"
              checked={includeVat}
              onChange={(event) => setIncludeVat(event.target.checked)}
            />
            <span className="mut" style={{ fontWeight: 700 }}>
              Add 7.5% VAT
            </span>
          </label>

          <div className="row" style={{ marginTop: 18, flexWrap: 'wrap' }}>
            {[500, 1000, 5000].map((quick) => (
              <button
                key={quick}
                type="button"
                className={amount === String(quick) ? 'chip on' : 'chip'}
                onClick={() => setAmount(String(quick))}
              >
                ₦{quick.toLocaleString('en-NG')}
              </button>
            ))}
          </div>
          {!validAmount ? (
            <p className="bad" role="alert" style={{ marginBottom: 12 }}>
              Enter a whole-number amount from ₦1 to ₦1,000,000,000.
            </p>
          ) : null}
        </div>
      </div>

      <div className="card tw">
        <div className="tr th g4">
          <span>Provider</span>
          <span>Card payments</span>
          <span>Bank transfer / virtual account</span>
          <span>Fee on this amount</span>
          <span>Website</span>
        </div>

        {withFees.map(({ gateway, fee }) => (
          <div className="tr g4" key={gateway.name}>
            <span>
              {gateway.name}
              <br />
              <span className="mut">{gateway.note}</span>
            </span>
            <span>{gateway.card}</span>
            <span>
              {gateway.transfer}
              {gateway.estimated ? (
                <>
                  <br />
                  <span className="pill p-p">Estimate</span>
                </>
              ) : null}
            </span>
            <span>
              <b>{fee === null ? 'Unavailable' : `₦${fee.toFixed(2)}`}</b>
              <br />
              {!gateway.estimated &&
              fee !== null &&
              fee === cheapestConfirmedFee ? (
                <span className="pill p-s">Lowest listed confirmed rate</span>
              ) : null}
            </span>
            <span>
              {gateway.url ? (
                <a
                  href={gateway.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open site
                </a>
              ) : (
                <span className="mut">Confirm official site</span>
              )}
            </span>
          </div>
        ))}
      </div>

      <p className="mut" style={{ marginTop: 12 }}>
        Fee estimates cover bank transfer / virtual account only. VAT is
        calculated on the estimated gateway fee, not the top-up amount.
      </p>
    </>
  )
}
