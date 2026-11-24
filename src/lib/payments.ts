import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { generateReference } from '@/lib/purchases'

export const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY ?? ''
export const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY ?? ''
export const PAYSTACK_CALLBACK_URL = process.env.PAYSTACK_CALLBACK_URL ?? ''

const PAYSTACK_BASE_URL = 'https://api.paystack.co'

/** True when a live payment gateway is configured for wallet funding. */
export function isGatewayConfigured(): boolean {
  return process.env.PAYSTACK_SECRET_KEY !== undefined && process.env.PAYSTACK_SECRET_KEY !== ''
}

export interface PaymentInit {
  /** Amount in Naira. */
  amount: number
  email: string
}

export interface PaymentInitResult {
  reference: string
  authorizationUrl: string
}

/**
 * Creates a hosted payment for the customer.
 *
 * The customer is not charged here — the gateway only collects through the
 * returned `authorizationUrl`. The wallet is credited later, after the
 * gateway confirms the payment (see `verifyPayment` and the webhook).
 */
export async function createPayment(input: PaymentInit): Promise<PaymentInitResult> {
  const secret = process.env.PAYSTACK_SECRET_KEY ?? ''
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${secret}:`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: Math.round(input.amount * 100), // kobo
      currency: 'NGN',
      reference: generateReference(),
      callback_url: PAYSTACK_CALLBACK_URL,
      email: input.email,
    }),
  })

  const body = (await response.json().catch(() => null)) as
    | { data?: { reference?: string; authorization_url?: string }; message?: string }
    | null
  const data = body?.data
  if (!response.ok || !data?.authorization_url) {
    throw new Error(body?.message ?? 'Payment gateway request failed')
  }

  return { reference: data.reference ?? '', authorizationUrl: data.authorization_url }
}

export interface VerifiedPayment {
  success: boolean
  status: string | null
  amount: number | null
}

/** Verifies a payment by its gateway reference. */
export async function verifyPayment(reference: string): Promise<VerifiedPayment | null> {
  const secret = process.env.PAYSTACK_SECRET_KEY ?? ''
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${secret}:`).toString('base64')}`,
    },
  })
  const body = (await response.json().catch(() => null)) as
    | { data?: { status?: string; amount?: number } | null }
    | null
  const data = body?.data
  if (!response.ok || !data) return null
  return { success: data.status === 'success', status: data.status ?? null, amount: data.amount ?? null }
}

/**
 * Validates a Paystack webhook signature.
 *
 * Paystack sends `x-paystack-signature` as `ch=<base64 hmac-sha256(secret, method + body + timestamp)>`.
 */
export function isValidWebhookSignature(input: {
  secret?: string
  method?: string
  path?: string
  rawBody?: string
  timestamp?: string | null
  signature?: string | null
}): boolean {
  const secret = input.secret ?? ''
  const method = input.method ?? 'POST'
  const path = input.path ?? '/api/webhooks/paystack'
  const rawBody = input.rawBody ?? ''
  const timestamp = input.timestamp ?? ''
  const signature = input.signature ?? ''
  if (!secret || !timestamp || !signature) return false

  const payload = `${method}${rawBody}${timestamp}`
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64')
  return expected === signature
}

export interface CreditResult {
  credited: boolean
  alreadyCredited: boolean
  balance: number
}

/**
 * Credits the wallet and records the funding transaction exactly once.
 *
 * Safe to call from both the verify endpoint and the webhook: the unique
 * constraint on `Transaction.ref` makes a repeated credit a no-op.
 */
export async function creditWalletAfterSuccessfulPayment(input: {
  userId: string
  amount: number
  ref: string
  title?: string
  subtitle?: string
}): Promise<CreditResult> {
  const existing = await prisma.transaction.findUnique({ where: { ref: input.ref } })
  if (existing) {
    const user = await prisma.user.findUnique({ where: { id: input.userId } })
    return { credited: false, alreadyCredited: true, balance: user?.balance ?? 0 }
  }

  const result = await prisma.$transaction([
    prisma.user.update({
      where: { id: input.userId },
      data: { balance: { increment: input.amount } },
    }),
    prisma.transaction.create({
      data: {
        userId: input.userId,
        title: input.title ?? 'Wallet Funding',
        subtitle: input.subtitle ?? 'Card Payment',
        amount: input.amount,
        status: 'Successful',
        phone: '-',
        ref: input.ref,
        typeKey: 'w',
        date: new Date(),
      },
    }),
  ])

  return { credited: true, alreadyCredited: false, balance: result[0].balance }
}
