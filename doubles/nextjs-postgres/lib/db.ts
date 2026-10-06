import { Client } from 'pg';

/**
 * A fresh Postgres client. DATABASE_URL when set; otherwise node-postgres
 * reads the discrete libpq variables itself: PGHOST, PGPORT, PGDATABASE,
 * PGUSER and PGPASSWORD.
 */
export function createClient(): Client {
  const connectionString = process.env.DATABASE_URL;
  return new Client({
    ...(connectionString ? { connectionString } : {}),
    connectionTimeoutMillis: 5_000,
  });
}
