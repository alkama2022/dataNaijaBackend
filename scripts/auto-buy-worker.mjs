/**
 * Auto-Buy worker.
 *
 * A tiny, dependency-free poller for self-hosted deployments (Railway,
 * Render, a VPS, …). It simply asks the backend to run the due schedules
 * once a minute.
 *
 *   BACKEND_URL=https://api.example.com CRON_SECRET=… npm run worker:auto-buy
 *
 * On Vercel you do not need this — use the cron entry in `vercel.json`.
 */

const BASE_URL = (process.env.BACKEND_URL || 'http://localhost:3000').replace(
  /\/$/,
  ''
)
const CRON_SECRET = process.env.CRON_SECRET
const INTERVAL_MS = Number(process.env.AUTO_BUY_POLL_MS || 60_000)

if (!CRON_SECRET) {
  console.error(
    '[auto-buy-worker] CRON_SECRET is not set. The worker cannot authenticate.'
  )
  process.exit(1)
}

async function tick() {
  try {
    const response = await fetch(`${BASE_URL}/api/auto-buy/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      console.error(
        `[auto-buy-worker] ${response.status} ${await response.text()}`
      )
      return
    }

    const body = await response.json()
    if (body.processed > 0) {
      console.log(
        `[auto-buy-worker] processed=${body.processed} successful=${body.successful} failed=${body.failed} skipped=${body.skipped}`
      )
    }
  } catch (error) {
    console.error('[auto-buy-worker] request failed:', error?.message || error)
  }
}

console.log(
  `[auto-buy-worker] polling ${BASE_URL}/api/auto-buy/run every ${INTERVAL_MS}ms`
)

tick()
setInterval(tick, INTERVAL_MS)
