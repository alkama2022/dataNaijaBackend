# DataNaija Backend

Next.js + TypeScript backend for the DataNaija Flutter mobile app.

This backend replaces the local `MockData` / `AppRepository` simulation in the
Flutter app with real API endpoints. The Flutter frontend does **not** change —
it keeps the same screens, widgets, navigation routes, and design system. Only
the data layer switches from hardcoded mock data to HTTP calls against this API.

## Architecture

The backend is intentionally simple:

- **Next.js 14** (App Router) — API route handlers in `src/app/api/.../route.ts`
- **Prisma** — type-safe database client, single file at `src/lib/prisma.ts`
- **PostgreSQL** — relational database for users, transactions, plans, etc.
- **bcryptjs** — password hashing
- **jose** — JWT signing and verification
- **Zod** — request validation (matches Flutter's phone regex exactly)

No unnecessary abstraction layers, services, or design patterns. Each route
handler is self-contained and handles its own auth check.

## Project Structure

```
prisma/schema.prisma        # Database schema (single source of truth)
prisma/seed.mjs             # Networks, bundles, providers and the first admin
scripts/promote-admin.mjs    # Gives an existing account access to /admin
scripts/auto-buy-worker.mjs  # Poller for self-hosted deployments
src/lib/prisma.ts           # Prisma client singleton
src/lib/auth.ts             # JWT sign / verify helpers
src/lib/validators.ts       # Zod validation schemas
src/lib/time.ts             # Time-zone helpers (Africa/Lagos)
src/lib/auto_buy/*          # The Auto-Buy scheduler
src/lib/admin/*             # The admin panel: analytics, settings, routing
src/app/api/*/route.ts      # Individual API endpoints
src/app/admin/**            # The admin panel (pages, server actions, styles)
src/app/layout.tsx          # Required Next.js root layout
src/app/page.tsx            # Health-check root page
```

## Prerequisites

- Node.js 18+
- PostgreSQL database (local or hosted, e.g. Neon, Supabase, Railway)
- `npm` or `yarn`

## Installation

```bash
# 1. Enter the backend folder
cd datanaija-backend

# 2. Install dependencies
npm install

# 3. Copy environment variables
cp .env.example .env
# Edit .env and set DATABASE_URL and JWT_SECRET

# 4. Generate Prisma client and push schema to database
npm run db:generate
npm run db:push

# 5. Start the development server
npm run dev
```

The API will be available at `http://localhost:3000/api/...`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for signing auth tokens (change in production) |
| `NEXT_PUBLIC_APP_URL` | No | Public URL of the app |
| `CRON_SECRET` | For Auto-Buy | Shared secret that authorises the scheduler endpoint |
| `ADMIN_API_KEY` | For the admin API | Shared key that authorises `/api/admin/auto-buy` |

## API Endpoints

All authenticated endpoints require `Authorization: Bearer <token>`.

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/auth/signin` | Phone + password login | No |
| POST | `/api/auth/signup` | Register new account | No |
| GET | `/api/networks` | List active networks | No |
| GET | `/api/data-plans?network=MTN&type=SME` | List data plans | No |
| POST | `/api/purchase` | Purchase data bundle | Yes |
| GET | `/api/wallet/balance` | Current balance | Yes |
| POST | `/api/wallet/fund` | Simulate wallet funding | Yes |
| GET | `/api/wallet/transactions` | Transaction list with filters | Yes |
| GET | `/api/transactions/:id` | Single transaction detail | Yes |
| POST | `/api/kyc/verify` | Submit BVN/NIN verification | Yes |
| GET | `/api/referral/me` | Referral code, bonus, friends | Yes |
| GET | `/api/notifications` | Notification list | Yes |
| GET | `/api/auto-buy` | List the customer's Auto-Buy rules | Yes |
| POST | `/api/auto-buy` | Create an Auto-Buy rule (consent required) | Yes |
| GET | `/api/auto-buy/:id` | One rule plus its execution history | Yes |
| PATCH | `/api/auto-buy/:id` | Edit / pause / resume a rule | Yes |
| DELETE | `/api/auto-buy/:id` | Delete a rule | Yes |
| GET | `/api/auto-buy/:id/executions` | Execution history of a rule | Yes |
| GET/POST | `/api/auto-buy/run` | Run the due schedules (scheduler only) | `CRON_SECRET` |
| GET | `/api/admin/auto-buy` | Every rule, for the admin panel | `ADMIN_API_KEY` |
| GET | `/api/admin/auto-buy/:id` | One rule plus history, for support | `ADMIN_API_KEY` |
| PATCH | `/api/admin/auto-buy/:id` | Pause / resume a customer's rule | `ADMIN_API_KEY` |

## The admin panel

The admin panel lives inside this app (`/admin`), so it reuses the
database, the session handling and the build. There is no second
application to deploy and no cross-origin call to make.

```
src/app/admin/
├── layout.tsx              # the design system stylesheet
├── (panel)/layout.tsx      # the shell: sidebar, badge counts, auth guard
├── (panel)/page.tsx        # Overview
├── (panel)/prices/         # Plans, provider costs, sell prices, margin
├── (panel)/users/          # Customers and agents
├── (panel)/orders/         # Orders, held orders, refunds
├── (panel)/auto-buy/       # The automatic purchase rules
├── (panel)/providers/      # Smart routing and provider health
├── (panel)/referrals/      # Commission rules and top referrers
├── (panel)/payments/       # Payment gateway comparison
└── signin/                 # The staff sign-in page
```

The design comes from the mockup in `adminPannel/`; the values were copied
into `src/app/admin/admin.css`.

**Signing in.** Staff sign in at `/admin/signin` with the account they use
in the app. Only accounts with `isAdmin` get in, and a suspended admin is
locked out. The session is the same JWT the mobile app uses, in an
`httpOnly` cookie.

**Getting the first admin:**

```bash
# While seeding:
ADMIN_PHONE=08012345678 ADMIN_PASSWORD=yourpassword npm run db:seed

# Or promote an account that already exists:
npm run admin:promote -- 08012345678
```

**What each tab needs**

| Tab | Source |
|---|---|
| Overview | `Transaction` (sales, profit, success rate) and `Provider` health |
| Prices | `DataPlan.price` against `ProviderPlanCost.cost` |
| Users | `User` (wallet, role, suspension) |
| Orders | `Transaction`, with `status = 'Pending'` for the ones held for review |
| Auto-Buy | `AutoBuySchedule` and `AutoBuyExecution` |
| Providers | `Provider`, `ProviderPlanCost` and the routing weights in `Setting` |
| Referrals | `Referral` and the commission rules in `Setting` |
| Payment methods | Static reference data in `src/lib/admin/payment-gateways.ts` |

**Things the panel does not do yet** — it says so on the screen rather
than pretending:

- The purchase flow does not route orders through the providers yet, so the
  provider ranking is a preview and the provider health only reflects the
  orders that were recorded with a provider.
- The referral commission rules are stored and shown, but the purchase flow
  does not pay them out yet.
- There are no live provider health checks, so the uptime is a configured
  value.

## Auto-Buy

Auto-Buy lets a customer create a rule — "buy this bundle, for this number,
on this schedule" — and the **server** keeps buying it, even while the
customer's phone is switched off.

### Where the code lives

```
prisma/schema.prisma                     # AutoBuySchedule + AutoBuyExecution
src/lib/auto_buy/frequency.ts            # the supported frequencies
src/lib/auto_buy/time.ts                 # Africa/Lagos time-zone helpers
src/lib/auto_buy/schedule.ts             # the schedule maths (next run, summary)
src/lib/auto_buy/provider.ts             # bundle lookup + delivery seam
src/lib/auto_buy/runner.ts               # the scheduler
src/lib/auto_buy/presenter.ts            # the JSON contract
src/app/api/auto-buy/**                  # the customer API
src/app/api/admin/auto-buy/**            # the admin API
scripts/auto-buy-worker.mjs              # poller for self-hosted deployments
```

### Supported frequencies

| Key | Label | Unit |
|---|---|---|
| `every_2_hours` | Every 2 hours | hours |
| `every_4_hours` | Every 4 hours | hours |
| `every_6_hours` | Every 6 hours | hours |
| `every_12_hours` | Every 12 hours | hours |
| `daily` | Every day | days |
| `every_2_days` | Every 2 days | days |
| `every_3_days` | Every 3 days | days |
| `weekly` | Every week | weeks (+ weekdays) |
| `every_2_weeks` | Every 2 weeks | weeks (+ weekdays) |
| `monthly` | Every month | months |
| `custom` | Custom schedule | any unit, 1–365 |

### How a schedule is calculated

Every rule is anchored on `anchorAt` — its very first slot. Every later slot
is derived from that anchor, so the schedule never drifts even if the service
was down for a while:

- **hours** — `anchor + n × interval` hours (absolute time)
- **days** — `anchor + n × interval` days, same wall-clock time
- **weeks** — the selected weekdays of every `n`-th week (counting from the
  anchor's week)
- **months** — the anchor's day-of-month, every `n`-th month. "The 31st"
  becomes the last day of shorter months.

All wall-clock maths happens in the schedule's own time zone
(`Africa/Lagos` by default, WAT = UTC+1, no daylight saving).

### Money safety

The runner in `src/lib/auto_buy/runner.ts` applies these rules in order:

1. **Claim** — a compare-and-swap on `nextRunAt` plus a five minute lock
   means two workers can never execute the same slot.
2. **Idempotency** — `@@unique([scheduleId, scheduledFor])` gives one
   execution row per rule per slot. A slot that already succeeded is skipped.
3. **Deterministic reference** — the transaction reference is derived from
   the rule id and the slot, and `Transaction.ref` is unique, so a repeated
   attempt cannot charge the customer twice.
4. **Price and availability re-check** — the bundle is looked up in the
   `DataPlan` catalogue again right before the purchase; the price stored on
   the rule is never trusted.
5. **Balance check** — the purchase is not attempted at all when the wallet
   cannot cover it.
6. **Atomic debit** — `updateMany({ where: { balance: { gte: price } } })`
   makes the debit conditional, so the wallet can never go negative.
7. **Provider confirmation** — a purchase is only reported as successful
   after the provider confirmed the delivery *and* the debit and the
   transaction record were committed together.

### Retry policy

| Failure | Back-off | Attempts |
|---|---|---|
| Provider outage | 15 → 30 → 60 minutes | 3 |
| Not enough balance | 6 hours | 3 |
| Bundle unavailable | 15 → 30 → 60 minutes | 3 |

A retry keeps the *same* logical slot, so the idempotency key and the
provider reference stay stable across attempts. When the retries are used up
the rule is **paused** and the customer is notified — nothing is ever
charged unexpectedly.

Slots that are more than 30 minutes old (the service was down) are recorded
as `Skipped` and the rule moves on. The customer is never charged for a
purchase that was missed.

### Running the scheduler

**Vercel** — `vercel.json` already contains the cron entry:

```json
{ "crons": [{ "path": "/api/auto-buy/run", "schedule": "* * * * *" }] }
```

Set `CRON_SECRET` in the environment; Vercel sends it as
`Authorization: Bearer $CRON_SECRET`.

**Any other host** — run the bundled worker next to the app:

```bash
BACKEND_URL=https://api.example.com CRON_SECRET=… npm run worker:auto-buy
```

**Check what would run** without executing anything:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/auto-buy/run?dryRun=1"
```

### Seeding the catalogue

The scheduler re-checks the bundle catalogue before every purchase, so the
`Network` and `DataPlan` tables have to be populated. The seed also creates
the providers the admin panel prices against:

```bash
npm run db:push
npm run db:seed
```

The seed is idempotent — running it again updates the existing rows.

## Connecting the Flutter App

1. Build the backend and deploy it (Vercel, Railway, Render, etc.).
2. In the Flutter app, add an HTTP client (e.g. `dio` or `http`).
3. Create an `ApiService` that calls the endpoints above.
4. Update `AppRepository` to call `ApiService` instead of `MockData`.
5. Add a boolean flag (e.g. `useMock`) to switch between mock and real API
   during testing. Remove it and delete `MockData` once the backend is verified.

Example Flutter call:

```dart
final response = await dio.post('/api/auth/signin', data: {
  'phone': '08012345678',
  'password': 'password123',
});
final token = response.data['token'];
// Store token in SharedPreferences, send as Bearer header thereafter.
```

## Database Migrations

Schema changes are managed through Prisma:

```bash
# Edit prisma/schema.prisma, then:
npx prisma migrate dev --name describe_change
```

For production, use `npx prisma migrate deploy`.

## Running Tests & Lint

The tests run against a real PostgreSQL database. They use their own
schema (`dn_test`) so they can never touch the data the development
server is using.

```bash
docker run -d --name dn-test-pg \
  -e POSTGRES_PASSWORD=dnpassword -e POSTGRES_USER=datanaija \
  -e POSTGRES_DB=datanaija -p 5433:5432 postgres:16-alpine

# Create the test schema once.
DATABASE_URL="postgresql://datanaija:dnpassword@localhost:5433/datanaija?schema=dn_test" \
  npx prisma db push --skip-generate

npm test           # 87 tests
npm run lint
npx tsc --noEmit
```

Point the tests at your own database with `DATABASE_URL`.

## Deployment

- Deploy the Next.js app to Vercel (zero-config), Railway, or Render.
- Host PostgreSQL on Neon, Supabase, or Railway.
- Set `DATABASE_URL` and `JWT_SECRET` in the hosting provider's env dashboard.
- Build the Flutter release APK: `flutter build apk --release`
- Update the Flutter `ApiService` base URL to the production backend.

## Adding a New API Endpoint

1. Create `src/app/api/<feature>/route.ts`.
2. Export a `GET`, `POST`, `PUT`, or `DELETE` async function.
3. Validate input with Zod (see `src/lib/validators.ts`).
4. Check auth with `verifyToken` from `src/lib/auth.ts` for protected routes.
5. Use `prisma` for database operations.
6. Return `NextResponse.json(...)`.

## Limitations

- KYC verification, wallet funding, and WhatsApp contact are simulated in this
  version. Real integrations (NIBSS/NIMC, Paystack/Flutterwave, WhatsApp
  Business API) require provider credentials and documentation not present here.
- No password reset flow yet (matches Flutter's "not part of this demo" stub).
- No rate limiting, email verification, or admin dashboard yet.
- The data delivery in `src/lib/auto_buy/provider.ts` is simulated. Replace
  the `DataProvider` implementation with the real aggregator — the rest of
  the Auto-Buy code does not change.
- The admin panel does not route purchases through the providers yet, does
  not pay the referral commission out yet, and has no live provider health
  checks. Each of those says so on the screen.
#   d a t a N a i j a B a c k e n d  
 