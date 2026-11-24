/**
 * Minimal in-process rate limiter.
 *
 * Fixed-window counter kept in process memory. Suitable for single-instance
 * deployments; move to a shared store (Redis) when running multiple instances.
 */

export interface RateLimitOptions {
  /** Max number of requests allowed inside the window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  /** Milliseconds until the caller may retry. */
  retryAfterMs: number
  /** Requests left inside the current window. */
  remaining: number
}

interface Hit {
  count: number
  resetAt: number
}

const hits = new Map<string, Hit>()

export function consume(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  const entry = hits.get(key)

  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + options.windowMs })
    return { allowed: true, retryAfterMs: 0, remaining: Math.max(0, options.limit - 1) }
  }

  if (entry.count >= options.limit) {
    return { allowed: false, retryAfterMs: entry.resetAt - now, remaining: 0 }
  }

  entry.count += 1
  return { allowed: true, retryAfterMs: 0, remaining: Math.max(0, options.limit - entry.count) }
}

/** Clears the counter for a key. */
export function resetRateLimit(key: string): void {
  hits.delete(key)
}
