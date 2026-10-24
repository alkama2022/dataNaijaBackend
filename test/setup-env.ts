/**
 * Jest bootstrap.
 *
 * Points the Prisma client at the test database before any module is
 * loaded. The tests use their own PostgreSQL schema (`dn_test`) so they
 * can never touch the data the development server is using.
 *
 * Override the URL with the `DATABASE_URL` environment variable when
 * running against your own PostgreSQL instance.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://datanaija:dnpassword@localhost:5433/datanaija?schema=dn_test'

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret'
process.env.CRON_SECRET = process.env.CRON_SECRET ?? 'test-cron-secret'
