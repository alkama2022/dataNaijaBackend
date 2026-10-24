import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'DataNaija Backend',
  description: 'API backend for the DataNaija Flutter mobile app',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
