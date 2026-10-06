import { afterEach, describe, expect, it } from 'vitest';
import { decideExitCode } from '../src/decide.js';
import { commitMatches, verify } from '../src/verify.js';
import { OTHER, SHA, fakeDeps, report, sendJson, serve } from './helpers.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function server(handler: Parameters<typeof serve>[0]) {
  const s = await serve(handler);
  closers.push(s.close);
  return s;
}

describe('verify', () => {
  it('passes a settled, green report on the expected commit (exit 0)', async () => {
    const s = await server((_req, res) => sendJson(res, report()));
    const result = await verify({ url: s.url, commit: SHA, timeoutSeconds: 10 }, fakeDeps());

    expect(decideExitCode(result)).toBe(0);
    expect(result.outside.find((c) => c.name === 'tls')?.status).toBe('skip');
    expect(result.outside.find((c) => c.name === 'https_redirect')?.status).toBe('skip');
  });

  it('accepts an abbreviated commit', async () => {
    expect(commitMatches(SHA.slice(0, 7), SHA)).toBe(true);
    expect(commitMatches(SHA.slice(0, 6), SHA)).toBe(false);
    expect(commitMatches(SHA, OTHER)).toBe(false);
    expect(commitMatches(SHA, null)).toBe(false);
  });

  it('returns 1 when a check failed, reading the failing report from a 503', async () => {
    const s = await server((_req, res) =>
      sendJson(res, report({ status: 'fail', checks: { database: { status: 'fail', code: 'database_unreachable', hint: 'Start the database.' } } }), 503),
    );
    const result = await verify({ url: s.url, commit: SHA, timeoutSeconds: 10 }, fakeDeps());

    expect(decideExitCode(result)).toBe(1);
    expect(result.inside[0]).toEqual({ name: 'database', status: 'fail', hint: 'Start the database.' });
  });

  it('polls until the report settles, then stops', async () => {
    const s = await server((_req, res, n) =>
      sendJson(res, n < 4 ? report({ settled: false, checks: { queue: { status: 'pending', retry_after: 5 } } }) : report()),
    );
    const deps = fakeDeps();
    const result = await verify({ url: s.url, commit: SHA, timeoutSeconds: 120 }, deps);

    expect(decideExitCode(result)).toBe(0);
    expect(s.hits()).toBe(4);
    expect(deps.clock.t - 1_000_000).toBe(15_000); // honoured retry_after: 3 × 5 s
  });

  it('returns 2 when still pending at the timeout', async () => {
    const s = await server((_req, res) => sendJson(res, report({ settled: false, checks: { queue: { status: 'pending', retry_after: 5 } } })));
    const result = await verify({ url: s.url, commit: SHA, timeoutSeconds: 30 }, fakeDeps());

    expect(decideExitCode(result)).toBe(2);
  });

  it('returns 3 when the wrong commit is serving', async () => {
    const s = await server((_req, res) => sendJson(res, report({ commit: OTHER })));
    const result = await verify({ url: s.url, commit: SHA, timeoutSeconds: 20 }, fakeDeps());

    expect(decideExitCode(result)).toBe(3);
    expect(result.servedCommit).toBe(OTHER);
  });

  it('keeps polling while the old release still serves, and passes once the new one does', async () => {
    const s = await server((_req, res, n) => sendJson(res, report({ commit: n < 3 ? OTHER : SHA })));
    const result = await verify({ url: s.url, commit: SHA, timeoutSeconds: 60 }, fakeDeps());

    expect(decideExitCode(result)).toBe(0);
  });

  it('returns 3 when nothing answers', async () => {
    const s = await server((_req, res) => {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<h1>Not found</h1>');
    });
    const result = await verify({ url: s.url, commit: SHA, timeoutSeconds: 10 }, fakeDeps());

    expect(decideExitCode(result)).toBe(3);
    expect(result.reachable).toBe(false);
  });

  it('returns 3 when the public tier hides the commit', async () => {
    const s = await server((_req, res) => sendJson(res, report({ tier: 'public' })));
    const result = await verify({ url: s.url, commit: SHA, timeoutSeconds: 10 }, fakeDeps());

    expect(decideExitCode(result)).toBe(3);
  });

  it('ignores the run ID when --run-id is not given', async () => {
    const s = await server((_req, res) => sendJson(res, report({ runIdMatch: false })));
    const result = await verify({ url: s.url, commit: SHA, timeoutSeconds: 10 }, fakeDeps());

    expect(decideExitCode(result)).toBe(0);
    expect(result.outside.some((c) => c.name === 'run_id')).toBe(false);
    expect(s.requests[0]!.headers['deploy-run-id']).toBeUndefined();
  });

  it('sends the run ID header and returns 3 on a mismatch', async () => {
    const s = await server((req, res) => sendJson(res, report({ runIdMatch: req.headers['deploy-run-id'] === 'run-1' })));

    const good = await verify({ url: s.url, commit: SHA, runId: 'run-1', timeoutSeconds: 10 }, fakeDeps());
    const bad = await verify({ url: s.url, commit: SHA, runId: 'run-2', timeoutSeconds: 10 }, fakeDeps());

    expect(decideExitCode(good)).toBe(0);
    expect(decideExitCode(bad)).toBe(3);
  });

  it('sends the token only as a bearer header', async () => {
    const s = await server((_req, res) => sendJson(res, report()));
    await verify({ url: s.url, commit: SHA, token: 't'.repeat(40), timeoutSeconds: 10 }, fakeDeps());

    expect(s.requests[0]!.headers.authorization).toBe(`Bearer ${'t'.repeat(40)}`);
    expect(s.requests[0]!.url).toBe('/.well-known/deploy-report');
  });
});

describe('verify --during-deploy', () => {
  it('counts a 502 during the switch as a failure (exit 1)', async () => {
    const s = await server((_req, res, n) => {
      if (n <= 2) return sendJson(res, report({ commit: OTHER }));
      if (n === 3) {
        res.writeHead(502, { 'content-type': 'text/html' });
        return res.end('<html>Bad Gateway</html>');
      }
      return sendJson(res, report({ commit: SHA }));
    });
    const result = await verify(
      { url: s.url, commit: SHA, timeoutSeconds: 10, duringDeploy: true },
      { fetch: globalThis.fetch.bind(globalThis), now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), streamIntervalMs: 20 },
    );

    expect(result.downtime?.failed).toBe(1);
    expect(result.outside.find((c) => c.name === 'downtime')?.status).toBe('fail');
    expect(decideExitCode(result)).toBe(1);
  });

  it('passes a switch with no failed requests and reports the longest gap', async () => {
    const s = await server((_req, res, n) => sendJson(res, report({ commit: n <= 3 ? OTHER : SHA })));
    const result = await verify(
      { url: s.url, commit: SHA, timeoutSeconds: 10, duringDeploy: true },
      { fetch: globalThis.fetch.bind(globalThis), now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), streamIntervalMs: 20 },
    );

    expect(result.downtime?.failed).toBe(0);
    expect(result.downtime?.longest_gap_ms).toBeGreaterThanOrEqual(0);
    expect(decideExitCode(result)).toBe(0);
  });
});
