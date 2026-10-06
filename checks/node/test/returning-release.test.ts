/*
 * A rollback, or a redeploy of a commit that already ran, brings back a
 * release whose results, probes, heartbeat and boot marker are still in the
 * store. None of that describes the new deployment. Ported from checks-php
 * (tests/Unit/ReturningReleaseTest.php).
 */
import { describe, expect, it } from 'vitest';
import { makeConfig, type Config } from '../src/config.js';
import { answerProbe } from '../src/probes.js';
import { readReport } from '../src/reader.js';
import { pass } from '../src/result.js';
import { runChecks } from '../src/runner.js';
import { FileStore } from '../src/store.js';
import { FakeClock, iso, newestCheckedAt, tempRoot } from './helpers.js';

const RELEASE_A = 'a'.repeat(40);
const RELEASE_B = 'b'.repeat(40);

/** Minute-aligned, so heartbeat minutes are predictable. */
const MINUTE_ZERO = 1_800_000_000 - (1_800_000_000 % 60);

function setup(): { store: FileStore; config: Config; clock: FakeClock } {
  const root = tempRoot();
  const config = makeConfig(root, { checks: { queue: { expected: 'redis' }, 'queue.release': {}, scheduler: {}, 'scheduler.release': {} } }, () => null);
  return { store: new FileStore(config.storePath), config, clock: new FakeClock(MINUTE_ZERO) };
}

/** One scheduled run of `commit`; `answeredBy` is the commit of the worker that answers the probe at once, or null for no worker. */
async function tick(store: FileStore, config: Config, clock: FakeClock, commit: string, answeredBy: string | null): Promise<void> {
  await runChecks(store, config, commit, { queue: async () => pass('ok', 'redis', 'redis 7.4') }, {
    now: clock.now,
    dispatchProbe: (probe) => {
      if (answeredBy !== null) answerProbe(store, probe, answeredBy, clock.now);
    },
  });
}

describe('a release that comes back', () => {
  it('dates the stale report of a returning release to its last run, not to the request', async () => {
    const { store, config, clock } = setup();

    for (let i = 0; i < 3; i++) {
      await tick(store, config, clock, RELEASE_A, RELEASE_A);
      clock.advance(60);
    }
    const lastRunOfA = clock.now - 60;
    for (let i = 0; i < 10; i++) {
      await tick(store, config, clock, RELEASE_B, RELEASE_B);
      clock.advance(60);
    }

    // Rolled back to A; read 5 s later, before A's scheduler has run.
    clock.advance(5);
    const switchedAt = clock.now;
    const before = readReport(store, config, RELEASE_A, clock.now);

    expect(before.deploy.checks.scheduler?.code).toBe('scheduler_results_stale');
    expect(newestCheckedAt(before)).toBe(lastRunOfA);
    expect(newestCheckedAt(before)).toBeLessThan(switchedAt);

    // A's scheduler runs; its worker answers.
    await tick(store, config, clock, RELEASE_A, RELEASE_A);
    clock.advance(5);
    const after = readReport(store, config, RELEASE_A, clock.now);

    expect(after.status).toBe('pass');
    expect(after.deploy.settled).toBe(true);
    expect(newestCheckedAt(after)).toBeGreaterThanOrEqual(switchedAt);
  });

  it('does not pass queue.release on a probe answered in an earlier life of the release', async () => {
    const { store, config, clock } = setup();

    await tick(store, config, clock, RELEASE_A, RELEASE_A);
    clock.advance(60);
    await tick(store, config, clock, RELEASE_A, RELEASE_A);
    clock.advance(60);
    await tick(store, config, clock, RELEASE_B, RELEASE_B);
    clock.advance(50);

    // Rolled back to A within the staleness window. A's scheduler runs; the
    // workers (still on B) have not taken the new probe yet.
    await tick(store, config, clock, RELEASE_A, null);
    clock.advance(10);
    const report = readReport(store, config, RELEASE_A, clock.now);

    expect(report.deploy.checks['queue.release']?.status).toBe('pending');
    expect(report.deploy.checks.queue?.status).toBe('pending');
    expect(report.deploy.settled).toBe(false);
  });

  it('fails queue.release once the workers still on the other release answer the returning release', async () => {
    const { store, config, clock } = setup();

    await tick(store, config, clock, RELEASE_A, RELEASE_A);
    clock.advance(60);
    await tick(store, config, clock, RELEASE_B, RELEASE_B);
    clock.advance(60);
    await tick(store, config, clock, RELEASE_B, RELEASE_B);
    clock.advance(10);
    await tick(store, config, clock, RELEASE_A, RELEASE_B);
    clock.advance(5);

    expect(readReport(store, config, RELEASE_A, clock.now).deploy.checks['queue.release']?.code).toBe('queue_release_mismatch');
  });

  it('treats the minute a returning release takes over in as its takeover minute', async () => {
    const { store, config, clock } = setup();

    await tick(store, config, clock, RELEASE_A, RELEASE_A); // minute 0
    clock.advance(60);
    await tick(store, config, clock, RELEASE_A, RELEASE_A); // minute 1
    clock.advance(60);
    await tick(store, config, clock, RELEASE_B, RELEASE_B); // minute 2
    clock.advance(60);
    await tick(store, config, clock, RELEASE_B, RELEASE_B); // minute 3, B's last run
    clock.advance(5);
    await tick(store, config, clock, RELEASE_A, RELEASE_A); // minute 3: A is back
    clock.advance(5);

    expect(readReport(store, config, RELEASE_A, clock.now).deploy.checks['scheduler.release']?.status).toBe('pass');

    // A real overlap after the return is still caught.
    clock.advance(50);
    await tick(store, config, clock, RELEASE_B, RELEASE_B); // minute 4
    await tick(store, config, clock, RELEASE_A, RELEASE_A); // minute 4
    clock.advance(5);

    expect(readReport(store, config, RELEASE_A, clock.now).deploy.checks['scheduler.release']?.code).toBe('scheduler_release_mismatch');
  });

  it('resets booted_at to when the returning release was first seen running again', async () => {
    const { store, config, clock } = setup();

    await tick(store, config, clock, RELEASE_A, RELEASE_A);
    clock.advance(60);
    await tick(store, config, clock, RELEASE_B, RELEASE_B);
    clock.advance(300);
    const returnedAt = clock.now;
    await tick(store, config, clock, RELEASE_A, RELEASE_A);
    clock.advance(5);

    expect(readReport(store, config, RELEASE_A, clock.now).deploy.release.booted_at).toBe(iso(returnedAt));
  });

  it('starts a fresh run for a redeploy of the same commit after its results went stale', async () => {
    const { store, config, clock } = setup();

    await tick(store, config, clock, RELEASE_A, RELEASE_A);
    clock.advance(600);
    // Redeployed; this time no worker runs. The old answered probe must not keep queue green.
    await tick(store, config, clock, RELEASE_A, null);
    clock.advance(60);
    await tick(store, config, clock, RELEASE_A, null);
    clock.advance(65);

    const report = readReport(store, config, RELEASE_A, clock.now);

    expect(report.deploy.checks.queue?.code).toBe('queue_no_worker');
    expect(report.deploy.release.booted_at).toBe(iso(MINUTE_ZERO + 600));
  });

  it('records since, and keeps it across runs of the same life', async () => {
    const { store, config, clock } = setup();

    await tick(store, config, clock, RELEASE_A, RELEASE_A);
    const firstRun = clock.now;
    clock.advance(60);
    await tick(store, config, clock, RELEASE_A, RELEASE_A);

    expect(store.read(`results-${RELEASE_A}`)).toMatchObject({ since: firstRun, ran_at: firstRun + 60 });
  });

  it('keeps the state of a release whose scheduler runs every minute next to another one', async () => {
    const { store, config, clock } = setup();

    await tick(store, config, clock, RELEASE_A, RELEASE_A);
    const bootedAt = clock.now;
    for (let i = 0; i < 4; i++) {
      clock.advance(55);
      await tick(store, config, clock, RELEASE_B, RELEASE_B);
      clock.advance(5);
      await tick(store, config, clock, RELEASE_A, RELEASE_A);
    }
    clock.advance(5);

    expect(readReport(store, config, RELEASE_A, clock.now).deploy.release.booted_at).toBe(iso(bootedAt));
  });
});
