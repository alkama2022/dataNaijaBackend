import './admin.css'

/**
 * The admin panel's styles.
 *
 * The design system is scoped under `.ad`, so importing it here is safe
 * for the rest of the app.
 */
export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
