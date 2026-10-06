import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startDeployReport, stopDeployReport } from '../src/next.js';
import { SHA, fakeClient, tempRoot } from './helpers.js';

afterEach(() => {
  stopDeployReport();
  delete process.env.NEXT_PHASE;
});

function app(checks: object = { database: {}, scheduler: {} }): string {
  const root = tempRoot();
  writeFileSync(join(root, 'REVISION'), SHA);
  writeFileSync(join(root, 'deploy-report.config.json'), JSON.stringify({ checks }));
  return root;
}

describe('startDeployReport', () => {
  it('runs once at start and keeps one timer per process', async () => {
    const root = app();
    const calls = { n: 0 };
    startDeployReport({ root, database: fakeClient({ calls }) });
    startDeployReport({ root, database: fakeClient({ calls }) });

    await expect.poll(() => existsSync(join(root, 'storage/deploy-report', `results-${SHA}.json`))).toBe(true);
    expect(calls.n).toBe(1);
  });

  it('does nothing during next build', async () => {
    process.env.NEXT_PHASE = 'phase-production-build';
    const root = app();
    const calls = { n: 0 };
    startDeployReport({ root, database: fakeClient({ calls }) });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.n).toBe(0);
    expect(existsSync(join(root, 'storage'))).toBe(false);
  });

  it('bounds a database check whose queries never answer: it fails as unreachable, ends the client, and the next tick runs', async () => {
    const root = app();
    const calls = { n: 0 };
    const ends = { n: 0 };
    const started = Date.now();
    startDeployReport({ root, database: fakeClient({ calls, ends, hangQueries: true }), timing: { checkTimeoutMs: 100, intervalMs: 250 } });

    const results = join(root, 'storage/deploy-report', `results-${SHA}.json`);
    await expect.poll(() => existsSync(results), { timeout: 2_000 }).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(JSON.parse(readFileSync(results, 'utf8')).checks.database).toMatchObject({ status: 'fail', code: 'database_unreachable' });
    expect(ends.n).toBeGreaterThanOrEqual(1);
    // The guard cleared: the next tick connected again.
    await expect.poll(() => calls.n, { timeout: 2_000 }).toBeGreaterThanOrEqual(2);
  });

  it('clears the running guard when a whole run outlives its bound, so the next tick runs', async () => {
    const root = app({ queue: {}, scheduler: {} });
    const dispatched = { n: 0 };
    startDeployReport({
      root,
      dispatchProbe: () => {
        dispatched.n++;
        return new Promise<never>(() => undefined);
      },
      timing: { runTimeoutMs: 100, intervalMs: 250 },
    });

    await expect.poll(() => dispatched.n, { timeout: 2_000 }).toBeGreaterThanOrEqual(2);
  });
});

