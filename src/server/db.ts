import 'server-only';
import pg from 'pg';

export type SqlClient = Pick<pg.ClientBase, 'query'>;

let pool: pg.Pool | null = null;

export function getDatabaseUrl(): string {
  if (process.env.ALLOW_TEST_DATABASE === 'true' && process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set.');
  }
  return url;
}

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = getDatabaseUrl();
    pool = new pg.Pool({ connectionString, max: 10 });
  }
  return pool;
}
