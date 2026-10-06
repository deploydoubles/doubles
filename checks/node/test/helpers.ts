import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseClient } from '../src/checks.js';

export const SHA = 'e'.repeat(40);
export const TOKEN = 'node-token-that-is-long-enough-0123456789';

export function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'dd-checks-node-'));
}

/** An in-memory stand-in for a node-postgres Client. */
export function fakeClient(
  opts: {
    version?: string;
    failConnect?: unknown;
    failCreate?: unknown;
    calls?: { n: number };
    queries?: string[];
    /** Every query after connect never settles, as on a wedged connection. */
    hangQueries?: boolean;
    ends?: { n: number };
  } = {},
): () => DatabaseClient {
  return () => {
    const table: string[] = [];
    return {
      async connect() {
        if (opts.calls) opts.calls.n++;
        if (opts.failConnect) throw opts.failConnect;
      },
      async query(text: string, values?: unknown[]) {
        opts.queries?.push(text);
        if (opts.hangQueries) return new Promise<never>(() => undefined);
        if (text.startsWith('CREATE TEMPORARY') && opts.failCreate) throw opts.failCreate;
        if (text.startsWith('SELECT version()')) return { rows: [{ v: opts.version ?? 'PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc' }] };
        if (text.startsWith('INSERT')) table.push(String(values?.[0]));
        if (text.startsWith('SELECT v')) return { rows: table.map((v) => ({ v })) };
        return { rows: [] };
      },
      async end() {
        if (opts.ends) opts.ends.n++;
      },
    };
  };
}

/** A clock the test can move. */
export class FakeClock {
  constructor(public now: number = 1_800_000_000) {}

  advance(seconds: number): void {
    this.now += seconds;
  }
}

/** The newest checked_at in a report, as a Unix time. */
export function newestCheckedAt(report: { deploy: { checks: Record<string, Record<string, unknown>> } }): number {
  return Math.max(...Object.values(report.deploy.checks).map((check) => Date.parse(String(check.checked_at)) / 1000));
}

export function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
