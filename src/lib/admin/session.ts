import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Admin panel session.
 *
 * The panel runs in the browser, so it uses a cookie instead of the
 * `Authorization` header the mobile app uses. The token is the same JWT,
 * signed by the same secret — only the transport differs.
 */

export const ADMIN_COOKIE = 'dn_admin_session'

/** Admin sessions last eight hours. */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8

/**
 * The signed-in admin, or `null` when there is no valid session.
 *
 * A session is only valid for an account that is still an admin and is
 * not suspended, so suspending an admin also locks them out.
 */
export async function getAdminUser() {
  const token = cookies().get(ADMIN_COOKIE)?.value
  if (!token) return null

  let payload: unknown
  try {
    payload = await verifyToken(token)
  } catch {
    return null
  }

  const userId = (payload as { userId?: string })?.userId
  if (!userId) return null

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !user.isAdmin || user.isSuspended) return null

  return user
}

/**
 * The signed-in admin. Redirects to the sign-in page when there is no
 * valid session.
 */
export async function requireAdmin() {
  const user = await getAdminUser()
  if (!user) redirect('/admin/signin')
  return user
}

/** Stores the session cookie. Called from the sign-in server action. */
export function startAdminSession(token: string) {
  cookies().set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

/** Clears the session cookie. */
export function endAdminSession() {
  cookies().delete(ADMIN_COOKIE)
}
