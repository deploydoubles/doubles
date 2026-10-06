import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expected as expectedOf, requiredEnv, type Config } from './config.js';
import { env as readEnv } from './environment.js';
import { isUnsupported } from './errors.js';
import { fail, pass, type CheckResult } from './result.js';
import { FileStore, Store } from './store.js';

/** The part of a node-postgres `Client` the database check uses. */
export interface DatabaseClient {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<unknown>;
}

export type Check = () => Promise<CheckResult>;

const CONNECT_TIMEOUT_MS = 10_000;
const MARKERS_KEPT = 20;

/**
 * The run-time checks for a Node app: the database through a fresh client
 * from the app's own factory, storage and env. Errors propagate to the
 * runner, which maps them to fixed codes; nothing here reads an error message.
 */
export function nodeChecks(config: Config, commit: string | null, database?: () => DatabaseClient): Record<string, Check> {
  const checks: Record<string, Check> = {
    storage: async () => storage(config.markerPath, commit),
    env: async () => envCheck(requiredEnv(config)),
  };
  if (database) checks.database = () => databaseCheck(database, expectedOf(config, 'database'));
  return checks;
}

async function databaseCheck(factory: () => DatabaseClient, expected: string | null): Promise<CheckResult> {
  const client = factory();
  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS);
    const version = (await client.query('SELECT version() AS v')).rows[0]?.v;
    const observed = engine(typeof version === 'string' ? version : '');
    const observedEngine = observed.split(' ')[0] ?? '';
    if (expected !== null && expected !== observedEngine) {
      return fail('database_engine_mismatch', 'connected to a different engine than declared', expected, observed);
    }

    const value = randomBytes(8).toString('hex');
    try {
      await client.query('CREATE TEMPORARY TABLE deploy_report_probe (v VARCHAR(32))');
    } catch (error) {
      if (isUnsupported(error)) {
        // Some servers have no temporary tables. That is a limit of the test, not a fault of the deploy.
        return { status: 'skip', expected, observed, code: 'database_write_unsupported', detail: 'connected; no temporary tables on this server, write test skipped' };
      }
      return fail('database_write_failed', 'write then read failed', expected, observed);
    }

    let read: unknown;
    try {
      await client.query('INSERT INTO deploy_report_probe (v) VALUES ($1)', [value]);
      read = (await client.query('SELECT v FROM deploy_report_probe')).rows[0]?.v;
    } catch {
      return fail('database_write_failed', 'write then read failed', expected, observed);
    } finally {
      // A temporary table ends with the session anyway.
      await client.query(dropTemporaryTable(observedEngine)).catch(() => undefined);
    }
    if (read !== value) return fail('database_write_failed', 'the value read back differs', expected, observed);

    return pass('connected; write then read ok', expected, observed);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Drops only the temporary table: a plain DROP TABLE could drop a real table
 * of the same name (and on MySQL commits an open transaction).
 */
export function dropTemporaryTable(engine: string): string {
  switch (engine) {
    case 'mysql':
    case 'mariadb':
      return 'DROP TEMPORARY TABLE deploy_report_probe';
    case 'postgres':
      return 'DROP TABLE pg_temp.deploy_report_probe';
    default:
      return 'DROP TABLE deploy_report_probe';
  }
}

/** `postgres 17.6` from `PostgreSQL 17.6 on …`; the banner itself never leaves this function. */
export function engine(banner: string): string {
  const postgres = /PostgreSQL (\d+)\.(\d+)/i.exec(banner);
  if (postgres) return `postgres ${Number(postgres[1])}.${Number(postgres[2])}`;
  const mariadb = /(\d+)\.(\d+)\.\d+-MariaDB/i.exec(banner);
  if (mariadb) return `mariadb ${Number(mariadb[1])}.${Number(mariadb[2])}`;
  const other = /^(\d+)\.(\d+)/.exec(banner);
  return other ? `mysql ${Number(other[1])}.${Number(other[2])}` : 'unknown';
}

function storage(directory: string, commit: string | null): CheckResult {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o775 });
  } catch {
    return fail('storage_not_writable', 'the storage directory could not be created');
  }
  const store = new FileStore(directory);
  const marker = store.read('marker');
  let releases = (Array.isArray(marker?.releases) ? (marker!.releases as unknown[]) : []).filter((r): r is string => typeof r === 'string');
  const key = Store.key(commit);
  if (!releases.includes(key)) releases = [...releases, key].slice(-MARKERS_KEPT);

  try {
    store.write('marker', { releases });
  } catch {
    return fail('storage_not_writable', 'the storage marker could not be written');
  }
  const read = store.read('marker');
  if (!Array.isArray(read?.releases) || !(read!.releases as unknown[]).includes(key)) {
    return fail('storage_not_writable', 'the storage marker did not read back');
  }
  const count = (read!.releases as unknown[]).length;
  return pass(`writable; markers from ${count} release${count === 1 ? '' : 's'} present`);
}

/** Names only — never a value. */
function envCheck(required: string[]): CheckResult {
  const missing = required.filter((name) => readEnv(name) === null);
  if (missing.length > 0) return fail('env_missing', `missing: ${missing.join(', ')}`);
  return pass(`${required.length} of ${required.length} required variables present`);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
