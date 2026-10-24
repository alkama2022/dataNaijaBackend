/**
 * Payment gateway reference data.
 *
 * The fees come from published guides and provider pages, and they change
 * often, so they live in code rather than in the database. The panel marks
 * the rates that have not been confirmed with the provider.
 */
export interface PaymentGateway {
  name: string
  /** A short note about the provider. */
  note: string
  /** What the card rate is, in words. */
  card: string
  /** What the bank transfer / virtual account rate is, in words. */
  transfer: string
  /** The transfer rate as a fraction of the amount, or null when unknown. */
  transferRate: number | null
  /** The cap on the transfer fee, in Naira, or null when there is none. */
  transferCap: number | null
  /** True when the rate still has to be confirmed with the provider. */
  estimated: boolean
  url: string | null
}

export const PAYMENT_GATEWAYS: PaymentGateway[] = [
  {
    name: 'Squad (GTCO)',
    note: 'Single source',
    card: 'Card rate not confirmed',
    transfer: '0.1%',
    transferRate: 0.001,
    transferCap: null,
    estimated: false,
    url: 'https://squadco.com',
  },
  {
    name: 'PaymentPoint',
    note: 'Promotional source',
    card: 'Not listed',
    transfer: 'About 0.5%',
    transferRate: 0.005,
    transferCap: null,
    estimated: true,
    url: null,
  },
  {
    name: 'Paystack',
    note: 'Developer friendly',
    card: '1.5% + ₦100 (₦100 waived under ₦2,500), cap ₦2,000',
    transfer: '1%, cap ₦300',
    transferRate: 0.01,
    transferCap: 300,
    estimated: false,
    url: 'https://paystack.com',
  },
  {
    name: 'Monnify',
    note: 'Built for virtual accounts',
    card: '1.3%, cap ₦2,000',
    transfer: 'Cap ₦1,000, rate unconfirmed',
    transferRate: null,
    transferCap: null,
    estimated: true,
    url: 'https://monnify.com',
  },
  {
    name: 'Flutterwave',
    note: 'Wide payment coverage',
    card: 'About 1.4%, cap ₦2,000',
    transfer: 'Rate unconfirmed',
    transferRate: null,
    transferCap: null,
    estimated: true,
    url: 'https://flutterwave.com',
  },
]

/** The VAT rate applied to gateway fees. */
export const VAT_RATE = 0.075

/**
 * The fee a gateway charges for a top-up.
 *
 * The fee is the rate applied to the amount, capped, and then the VAT is
 * added on top.
 */
export function gatewayFee(
  gateway: PaymentGateway,
  amount: number,
  includeVat: boolean
): number | null {
  if (gateway.transferRate === null) return null
  const fee = Math.min(
    amount * gateway.transferRate,
    gateway.transferCap ?? Infinity
  )
  return fee * (includeVat ? 1 + VAT_RATE : 1)
}
