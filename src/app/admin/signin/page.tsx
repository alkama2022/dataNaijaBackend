import { redirect } from 'next/navigation'
import { getAdminUser } from '@/lib/admin/session'
import { signInAction } from '../actions'

/**
 * The admin sign-in page.
 *
 * Staff sign in with the same account they use in the app, but only
 * accounts flagged as admins get in.
 */
export default async function AdminSignInPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string }
}) {
  // Already signed in? Go straight to the panel.
  if (await getAdminUser()) {
    redirect('/admin')
  }

  return (
    <div
      className="ad"
      style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}
    >
      <main className="main" style={{ maxWidth: 420, width: '100%' }}>
        <div className="top">
          <div>
            <h1 className="h1">DataNaija Admin</h1>
            <p className="mut">Sign in with your staff account.</p>
          </div>
        </div>

        {searchParams.error ? (
          <div
            className="note"
            style={{ borderColor: '#F0B8B3', color: '#9B1C12' }}
          >
            {searchParams.error}
          </div>
        ) : null}

        <div className="card">
          <form action={signInAction} className="fgrid">
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="lb" htmlFor="phone">
                Phone number
              </label>
              <input
                id="phone"
                name="phone"
                className="f"
                inputMode="tel"
                autoComplete="username"
                placeholder="08012345678"
                required
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="lb" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                className="f"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
            </div>
            <input
              type="hidden"
              name="next"
              value={searchParams.next ?? '/admin'}
            />
            <div style={{ gridColumn: '1 / -1' }}>
              <button className="btn" type="submit" style={{ width: '100%' }}>
                Sign in
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
