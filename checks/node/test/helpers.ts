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
export function fakeClient(opts: { version?: string; failConnect?: unknown; calls?: { n: number } } = {}): () => DatabaseClient {
  return () => {
    const table: string[] = [];
    return {
      async connect() {
        if (opts.calls) opts.calls.n++;
        if (opts.failConnect) throw opts.failConnect;
      },
      async query(text: string, values?: unknown[]) {
        if (text.startsWith('SELECT version()')) return { rows: [{ v: opts.version ?? 'PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc' }] };
        if (text.startsWith('INSERT')) table.push(String(values?.[0]));
        if (text.startsWith('SELECT v')) return { rows: table.map((v) => ({ v })) };
        return { rows: [] };
      },
      async end() {},
    };
  };
}
