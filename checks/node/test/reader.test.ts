/*
 * The read-time rules — staleness, scheduler, queue judgement, the boot
 * marker and the store — ported from checks-php (tests/Unit/ReportReaderTest.php).
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeConfig, type Config } from '../src/config.js';
import { answerProbe } from '../src/probes.js';
import { readReport, STALE_AFTER } from '../src/reader.js';
import { fail, pass } from '../src/result.js';
import { runChecks } from '../src/runner.js';
import { FileStore, Store } from '../src/store.js';
import { FakeClock, iso, tempRoot } from './helpers.js';

const COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);

function readerConfig(root: string = tempRoot()): Config {
  return makeConfig(
    root,
    { checks: { database: { expected: 'postgres' }, queue: { expected: 'redis' }, 'queue.release': {}, scheduler: {}, 'scheduler.release': {} } },
    () => null,
  );
}

function setup(clockAt?: number): { store: FileStore; config: Config; clock: FakeClock } {
  const config = readerConfig();
  return { store: new FileStore(config.storePath), config, clock: new FakeClock(clockAt) };
}

/** Runs the scheduled checks with passing stubs; probes are recorded but answered only when `onProbe` does so. */
async function runOnce(store: FileStore, config: Config, clock: FakeClock, onProbe: ((probe: string) => void) | null = null, commit = COMMIT): Promise<void> {
  await runChecks(
    store,
    config,
    commit,
    {
      database: async () => pass('ok', 'postgres', 'postgres 17.6'),
      queue: async () => pass('ok', 'redis', 'redis 7.4'),
    },
    { now: clock.now, dispatchProbe: onProbe ?? (() => undefined) },
  );
}

const read = (store: FileStore, config: Config, clock: FakeClock, commit = COMMIT) => readReport(store, config, commit, clock.now);

describe('staleness and the scheduler', () => {
  it('reports only scheduler fail when stored results are older than 180 s, dated to the last run', async () => {
    const { store, config, clock } = setup();
    await runOnce(store, config, clock, (p) => answerProbe(store, p, COMMIT, clock.now));
    const ranAt = clock.now;
    clock.advance(181);
    const report = read(store, config, clock);

    expect(Object.keys(report.deploy.checks)).toEqual(['scheduler']);
    expect(report.deploy.checks.scheduler).toMatchObject({ status: 'fail', code: 'scheduler_results_stale', checked_at: iso(ranAt) });
    expect(report.status).toBe('fail');
    expect(report.deploy.settled).toBe(true);
  });

  it('keeps results that are exactly 180 s old', async () => {
    const { store, config, clock } = setup();
    await runOnce(store, config, clock, (p) => answerProbe(store, p, COMMIT, clock.now));
    clock.advance(STALE_AFTER);

    expect(Object.keys(read(store, config, clock).deploy.checks)).toEqual(expect.arrayContaining(['database', 'queue']));

    clock.advance(1);
    expect(Object.keys(read(store, config, clock).deploy.checks)).toEqual(['scheduler']);
  });

  it('is pending before the first scheduled run and fails once 120 s pass without a heartbeat', () => {
    const { store, config, clock } = setup();

    const first = read(store, config, clock);
    expect(first.deploy.settled).toBe(false);
    expect(first.status).toBe('warn');
    expect(new Set(Object.values(first.deploy.checks).map((c) => c.status))).toEqual(new Set(['pending']));

    clock.advance(121);
    const later = read(store, config, clock);
    expect(Object.keys(later.deploy.checks)).toEqual(['scheduler']);
    expect(later.deploy.checks.scheduler?.code).toBe('scheduler_not_running');
  });

  it('dates scheduler and scheduler.release to the heartbeat, never to the request', async () => {
    const { store, config, clock } = setup();
    await runOnce(store, config, clock, (p) => answerProbe(store, p, COMMIT, clock.now));
    const beat = clock.now;
    clock.advance(40);
    const report = read(store, config, clock);

    expect(report.deploy.checks.scheduler).toMatchObject({ status: 'pass', checked_at: iso(beat) });
    expect(report.deploy.checks['scheduler.release']).toMatchObject({ status: 'pass', checked_at: iso(beat) });
    expect(report.deploy.checks.database).toMatchObject({ checked_at: iso(beat) });
  });

  it('fails scheduler.release when two releases run the scheduler in the same minute', async () => {
    const { store, config, clock } = setup(1_800_000_000 - (1_800_000_000 % 60));
    const answer = (p: string) => answerProbe(store, p, COMMIT, clock.now);

    for (let minute = 0; minute < 3; minute++) {
      await runOnce(store, config, clock, answer);
      await runOnce(store, config, clock, null, OTHER_COMMIT);
      clock.advance(60);
    }
    clock.advance(-50);

    expect(read(store, config, clock).deploy.checks['scheduler.release']).toMatchObject({ status: 'fail', code: 'scheduler_release_mismatch' });
  });

  it('passes scheduler.release after a clean switch from the previous release', async () => {
    const { store, config, clock } = setup(1_800_000_000 - (1_800_000_000 % 60));
    const answer = (p: string) => answerProbe(store, p, COMMIT, clock.now);

    await runOnce(store, config, clock, null, OTHER_COMMIT);
    clock.advance(60);
    await runOnce(store, config, clock, null, OTHER_COMMIT);
    // the switch happens; the old release ran once more in the takeover minute
    await runOnce(store, config, clock, answer);
    clock.advance(60);
    await runOnce(store, config, clock, answer);
    clock.advance(10);

    expect(read(store, config, clock).deploy.checks['scheduler.release']?.status).toBe('pass');
  });
});

describe('the queue', () => {
  it('passes queue and queue.release when the worker on this release answers, dated to the answer', async () => {
    const { store, config, clock } = setup();
    await runOnce(store, config, clock, (p) => answerProbe(store, p, COMMIT, clock.now + 1));
    clock.advance(30);
    const report = read(store, config, clock);

    expect(report.deploy.checks.queue).toMatchObject({ status: 'pass', expected: 'redis', observed: 'redis 7.4', checked_at: iso(clock.now - 29) });
    expect(report.deploy.checks['queue.release']).toMatchObject({ status: 'pass', checked_at: iso(clock.now - 29) });
    expect(report.status).toBe('pass');
    expect(report.deploy.settled).toBe(true);
  });

  it('fails queue.release when the worker runs another commit', async () => {
    const { store, config, clock } = setup();
    await runOnce(store, config, clock, (p) => answerProbe(store, p, OTHER_COMMIT, clock.now));
    const report = read(store, config, clock);

    expect(report.deploy.checks.queue?.status).toBe('pass');
    expect(report.deploy.checks['queue.release']).toMatchObject({ status: 'fail', code: 'queue_release_mismatch' });
  });

  it('keeps queue pending while the oldest unanswered probe is younger than 120 s', async () => {
    const { store, config, clock } = setup();
    await runOnce(store, config, clock);
    clock.advance(60);
    await runOnce(store, config, clock);
    const report = read(store, config, clock);

    expect(report.deploy.checks.queue?.status).toBe('pending');
    expect(report.deploy.checks.queue?.retry_after).toBeGreaterThan(0);
    expect(report.deploy.settled).toBe(false);
  });

  it('fails queue against the oldest unanswered probe even while fresh probes keep arriving', async () => {
    const { store, config, clock } = setup();
    const first = clock.now;
    for (let minute = 0; minute < 3; minute++) {
      await runOnce(store, config, clock);
      clock.advance(60);
    }
    // The newest probe is 60 s old; the oldest is 180 s old.
    const report = read(store, config, clock);

    expect(report.deploy.checks.queue).toMatchObject({ status: 'fail', code: 'queue_no_worker', checked_at: iso(first) });
    expect(report.deploy.checks['queue.release']).toMatchObject({ status: 'fail', code: 'queue_no_worker' });
    expect(report.deploy.settled).toBe(true);
  });

  it('does not fail the queue on one lost probe while later probes are answered', async () => {
    const { store, config, clock } = setup();
    await runOnce(store, config, clock); // this probe is lost: the job failed or was dropped
    clock.advance(60);
    for (let minute = 0; minute < 4; minute++) {
      await runOnce(store, config, clock, (p) => answerProbe(store, p, COMMIT, clock.now));
      clock.advance(60);
    }

    expect(read(store, config, clock).deploy.checks.queue?.status).toBe('pass');
  });

  it('still fails the queue when probes dispatched after the last answered one wait too long', async () => {
    const { store, config, clock } = setup();
    await runOnce(store, config, clock, (p) => answerProbe(store, p, COMMIT, clock.now));
    clock.advance(60);
    // The worker dies.
    for (let minute = 0; minute < 3; minute++) {
      await runOnce(store, config, clock);
      clock.advance(60);
    }

    expect(read(store, config, clock).deploy.checks.queue?.code).toBe('queue_no_worker');
  });

  it('skips queue.release when the queue check itself failed, dated to that run', async () => {
    const { store, config, clock } = setup();
    let dispatched = 0;
    await runChecks(store, config, COMMIT, { queue: async () => fail('queue_driver_mismatch', 'different backend', 'redis', 'sync') }, {
      now: clock.now,
      dispatchProbe: () => {
        dispatched++;
      },
    });
    const ranAt = clock.now;
    clock.advance(20);
    const report = read(store, config, clock);

    expect(dispatched).toBe(0);
    expect(report.deploy.checks.queue).toMatchObject({ status: 'fail', code: 'queue_driver_mismatch', checked_at: iso(ranAt) });
    expect(report.deploy.checks['queue.release']).toEqual({ status: 'skip', checked_at: iso(ranAt) });
  });

  it('fails the queue with queue_error and skips queue.release when the probe cannot be dispatched', async () => {
    const { store, config, clock } = setup();
    await runChecks(store, config, COMMIT, { queue: async () => pass('ok', 'redis', 'redis 7.4') }, {
      now: clock.now,
      dispatchProbe: () => {
        throw new Error('redis://leaky_user:leaky_password@queue.internal refused');
      },
    });
    const report = read(store, config, clock);

    expect(report.deploy.checks.queue).toMatchObject({ status: 'fail', code: 'queue_error' });
    expect(report.deploy.checks['queue.release']?.status).toBe('skip');
    expect(store.names(Store.probePrefix(COMMIT))).toEqual([]);
  });
});

describe('the boot marker and the store', () => {
  it('creates the boot marker without hard links, once', () => {
    const config = readerConfig();
    const store = new FileStore(config.storePath, () => {
      throw Object.assign(new Error('no hard links here'), { code: 'EPERM' });
    });
    const clock = new FakeClock();

    const first = read(store, config, clock);
    clock.advance(30);
    const second = read(store, config, clock);

    expect(store.read(Store.boot(COMMIT))).toEqual({ at: 1_800_000_000 });
    expect(first.deploy.release.booted_at).toBe(iso(1_800_000_000));
    expect(second.deploy.release.booted_at).toBe(iso(1_800_000_000));
    expect(readdirSync(config.storePath)).toEqual([`boot-${COMMIT}.json`]);

    clock.advance(100);
    expect(read(store, config, clock).deploy.checks.scheduler?.code).toBe('scheduler_not_running');
  });

  it('fails with a fixed code instead of staying pending when no boot marker can be stored', () => {
    const root = tempRoot();
    const file = join(root, 'a-file');
    writeFileSync(file, '');
    // A directory below a regular file can never be created.
    const config = makeConfig(root, { store_path: join(file, 'store'), checks: { database: {}, scheduler: {} } }, () => null);
    const report = readReport(new FileStore(config.storePath), config, COMMIT, 1_800_000_000);

    expect(Object.keys(report.deploy.checks)).toEqual(['scheduler']);
    expect(report.deploy.checks.scheduler).toMatchObject({ status: 'fail', code: 'report_store_unwritable' });
    expect(report.deploy.settled).toBe(true);
    expect(report.status).toBe('fail');
  });

  it('writes results atomically through a temporary file', () => {
    const root = tempRoot();
    const store = new FileStore(root);
    store.write('results-x', { ran_at: 1 });

    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(store.read('results-x')).toEqual({ ran_at: 1 });
  });
});

describe('the runner', () => {
  it('hands the error class, never its message, to the warn hook when a check throws', async () => {
    const { store, config } = setup();
    class PgDatabaseError extends Error {}
    const warnings: string[] = [];

    await runChecks(
      store,
      config,
      COMMIT,
      {
        database: async () => {
          throw Object.assign(new PgDatabaseError('connect to secret-host.internal as leaky_user failed'), { code: '08006' });
        },
      },
      { now: 1_800_000_000, warn: (message) => warnings.push(message) },
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('database');
    expect(warnings[0]).toContain('PgDatabaseError');
    expect(warnings[0]).not.toContain('secret-host');
    expect(warnings[0]).not.toContain('leaky_user');
    expect(warnings[0]).not.toContain('08006');
  });

  it('never reads a message, runs a check or opens a connection while reading', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/reader.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('.message');
    expect(source).not.toContain('dispatchProbe');
    expect(source).not.toContain('connect(');
  });
});
