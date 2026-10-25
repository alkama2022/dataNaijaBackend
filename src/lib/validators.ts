import { z } from 'zod'

// Nigerian mobile regex: starts with 07/08/09, second digit 0 or 1, then 8 digits.
// Matches the Flutter phone_validator.dart exactly so both ends agree.
export const phoneSchema = z.string().regex(
  /^0[789][01]\d{8}$/,
  'Invalid Nigerian phone number'
)

export const signinSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

export const signupSchema = z.object({
  fullName: z.string().min(2, 'Full name is required'),
  phone: phoneSchema,
  email: z.string().email().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

export const kycSchema = z.object({
  type: z.enum(['BVN', 'NIN']),
  id: z.string().length(11, 'ID must be exactly 11 digits'),
  consent: z.boolean().refine((v) => v === true, {
    message: 'Consent is required',
  }),
})

/**
 * A data purchase.
 *
 * `price` is what the client displayed. The server never charges it — the
 * bundle is looked up in the catalogue and the catalogue price is used.
 * It is still accepted so the client can send its usual payload.
 */
export const purchaseSchema = z.object({
  network: z.string().min(1),
  type: z.string().min(1),
  // The bundle family, e.g. `SME`. Two families sell the same size, so the
  // client sends it to make the bundle unambiguous.
  dataType: z.string().min(1).optional(),
  price: z.number().int().positive('Price must be positive').optional(),
  planId: z.string().min(1).optional(),
  phone: phoneSchema,
})

export const fundSchema = z.object({
  amount: z.number().int().positive('Amount must be positive'),
  method: z.enum(['Card Payment', 'USSD']),
})

// ── Transaction reports ─────────────────────────────────────────────

/** Every issue category the support flow accepts today. */
export const transactionReportCategories = [
  'Data or airtime not received',
  'Incorrect transaction amount',
  'Unexpected wallet deduction',
  'Duplicate transaction',
  'Transaction stuck on pending',
  'Incorrect transaction status',
  'Other issue',
] as const

export const transactionReportSchema = z.object({
  transactionId: z.string().min(1, 'Transaction id is required'),
  category: z.enum(transactionReportCategories),
  message: z.string().max(1000, 'Message must be 1000 characters or fewer').optional(),
})

// ── Auto-Buy ─────────────────────────────────────────────────────

/** Every frequency key the API accepts. Mirrors AUTO_BUY_FREQUENCIES. */
export const autoBuyFrequencySchema = z.enum([
  'every_2_hours',
  'every_4_hours',
  'every_6_hours',
  'every_12_hours',
  'daily',
  'every_2_days',
  'every_3_days',
  'weekly',
  'every_2_weeks',
  'monthly',
  'custom',
])

export const autoBuyUnitSchema = z.enum(['hours', 'days', 'weeks', 'months'])

/** `'HH:mm'` wall-clock time. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time, expected HH:mm')

/** `'YYYY-MM-DD'` calendar date. */
export const startDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date, expected YYYY-MM-DD')

export const autoBuyCreateSchema = z.object({
  network: z.string().min(1),
  planType: z.string().min(1),
  planGb: z.string().min(1),
  planDays: z.string().min(1),
  planId: z.string().optional().nullable(),
  // The client sends the price it displayed; the server re-checks the real
  // price against the catalogue before saving.
  price: z.number().int().positive('Price must be positive'),
  phone: phoneSchema,
  frequency: autoBuyFrequencySchema,
  interval: z.number().int().min(1).max(365).optional(),
  unit: autoBuyUnitSchema.optional(),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  timeOfDay: timeOfDaySchema,
  startDate: startDateSchema.optional().nullable(),
  timezone: z.string().default('Africa/Lagos'),
  // Explicit consent is mandatory before a rule may be activated.
  consent: z.boolean().refine((v) => v === true, {
    message: 'Consent is required to activate Auto-Buy',
  }),
})

/** Updates are all optional; `status` drives pause/resume. */
export const autoBuyUpdateSchema = z.object({
  network: z.string().min(1).optional(),
  planType: z.string().min(1).optional(),
  planGb: z.string().min(1).optional(),
  planDays: z.string().min(1).optional(),
  planId: z.string().optional().nullable(),
  price: z.number().int().positive().optional(),
  phone: phoneSchema.optional(),
  frequency: autoBuyFrequencySchema.optional(),
  interval: z.number().int().min(1).max(365).optional(),
  unit: autoBuyUnitSchema.optional(),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  timeOfDay: timeOfDaySchema.optional(),
  startDate: startDateSchema.optional().nullable(),
  timezone: z.string().optional(),
  status: z.enum(['Active', 'Paused']).optional(),
  // Required when a paused rule is re-activated.
  consent: z.boolean().optional(),
})
