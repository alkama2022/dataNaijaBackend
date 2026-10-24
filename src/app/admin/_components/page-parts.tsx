/**
 * Small building blocks shared by the admin pages.
 *
 * They exist so the pages stay readable — the design itself lives in
 * `admin.css`.
 */

/** The page title and the note on the right of the top bar. */
export function PageHeader({
  title,
  subtitle,
  tag = 'Live data',
}: {
  title: string
  subtitle: string
  tag?: string
}) {
  return (
    <div className="top">
      <div>
        <h1 className="h1">{title}</h1>
        <p className="mut">{subtitle}</p>
      </div>
      <span className="tag">{tag}</span>
    </div>
  )
}

/** The yellow note at the top of a page. */
export function Note({ children }: { children: React.ReactNode }) {
  return <div className="note">{children}</div>
}

/** A flash message after an action, or nothing when there is none. */
export function Flash({
  message,
  error,
}: {
  message?: string
  error?: string
}) {
  if (error) {
    return (
      <div className="note" style={{ borderColor: '#F0B8B3', color: '#9B1C12' }}>
        {error}
      </div>
    )
  }
  if (!message) return null
  return (
    <div className="toast" role="status">
      {message}
    </div>
  )
}

/** Shown when a table has no rows. */
export function EmptyRow({ columns, children }: { columns: number; children: React.ReactNode }) {
  return (
    <p className="mut empty" style={{ gridColumn: `1 / ${columns + 1}` }}>
      {children}
    </p>
  )
}
