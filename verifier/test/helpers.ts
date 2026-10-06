import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Deps } from '../src/verify.js';

export const SHA = 'a'.repeat(40);
export const OTHER = 'b'.repeat(40);

export type Handler = (req: IncomingMessage, res: ServerResponse, n: number) => void;

export async function serve(handler: Handler): Promise<{ url: string; close: () => Promise<void>; hits: () => number; requests: IncomingMessage[] }> {
  let n = 0;
  const requests: IncomingMessage[] = [];
  const server = createServer((req, res) => {
    n++;
    requests.push(req);
    handler(req, res, n);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits: () => n,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function report(opts: { status?: string; settled?: boolean; commit?: string | null; checks?: Record<string, object>; runIdMatch?: boolean | null; tier?: 'full' | 'public' } = {}): object {
  const tier = opts.tier ?? 'full';
  const deploy: Record<string, unknown> = {
    spec_version: '0.1',
    tier,
    settled: opts.settled ?? true,
    checks: opts.checks ?? { database: { status: 'pass' } },
  };
  if (tier === 'full') {
    deploy.app = { runtime: 'php 8.4' };
    deploy.release = { commit: opts.commit === undefined ? SHA : opts.commit, booted_at: null, run_id_match: opts.runIdMatch ?? null };
  }
  return { status: opts.status ?? 'pass', deploy };
}

export function sendJson(res: ServerResponse, body: object, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/health+json' });
  res.end(JSON.stringify(body));
}

/** Deps with a fake clock: sleeping advances time instantly. */
export function fakeDeps(): Deps & { clock: { t: number } } {
  const clock = { t: 1_000_000 };
  return {
    clock,
    fetch: globalThis.fetch.bind(globalThis),
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.t += ms;
    },
    streamIntervalMs: 250,
  };
}
