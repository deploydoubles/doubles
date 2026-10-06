import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startDeployReport, stopDeployReport } from '../src/next.js';
import { SHA, fakeClient, tempRoot } from './helpers.js';

afterEach(() => {
  stopDeployReport();
  delete process.env.NEXT_PHASE;
});

function app(): string {
  const root = tempRoot();
  writeFileSync(join(root, 'REVISION'), SHA);
  writeFileSync(join(root, 'deploy-report.config.json'), JSON.stringify({ checks: { database: {}, scheduler: {} } }));
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
});
