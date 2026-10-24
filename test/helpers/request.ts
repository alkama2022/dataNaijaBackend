import { NextRequest } from 'next/server'
import { signToken } from '@/lib/auth'

/**
 * Helpers for building requests in the backend tests.
 */

/** Creates a `NextRequest` with a JSON body. */
export function jsonRequest(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(
    new Request(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  )
}

/** Creates a `NextRequest` without a body. */
export function emptyRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(
    new Request(url, { method, headers: { 'content-type': 'application/json', ...headers } })
  )
}

/** Builds the `Authorization` header for a user id. */
export async function authHeader(
  userId: string
): Promise<Record<string, string>> {
  const token = await signToken({ userId } as { userId: string; phone: string })
  return { authorization: `Bearer ${token}` }
}

/** Reads a JSON response body. */
export async function readJson(response: Response): Promise<any> {
  return await response.json()
}
