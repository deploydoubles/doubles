import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { declares, type Config } from './config.js';
import { fail, fromStore, pending, pass, timestamp, toReport, type CheckResult } from './result.js';
import { FileStore, Store } from './store.js';
import type { FullReport } from './tier.js';

/** Results older than this mean the scheduler stopped: report only `scheduler: fail`. */
export const STALE_AFTER = 180;
/** No heartbeat for this long (from boot when there never was one) means no scheduler. */
export const SCHEDULER_GRACE = 120;
/** The oldest unanswered probe may wait this long before `queue` fails. */
export const QUEUE_GRACE = 120;

/**
 * Builds the full report from the result store — the same rules as
 * checks-php's ReportReader. It only reads: it never runs a check or touches
 * a backing service. The one write it may make is the release's boot marker,
 * once, when the store has none.
 *
 * Every `checked_at` is the time of the evidence a result rests on — when the
 * scheduled run produced it, or when the record it was derived from was
 * written — never the time of the request. A verifier can therefore tell a
 * result produced by this deployment from one left by an earlier life of the
 * same commit (a rollback or a redeploy) that the scheduler has not yet
 * replaced.
 */
export function readReport(store: FileStore, config: Config, commit: string | null, now: number = epoch()): FullReport {
  const results = store.read(Store.results(commit));
  if (results === null) return beforeFirstRun(store, config, commit, now);

  const ranAt = Number.isInteger(results.ran_at) ? (results.ran_at as number) : 0;
  if (now - ranAt > STALE_AFTER) {
    return build(store, config, commit, { scheduler: at(fail('scheduler_results_stale', `last scheduled run ${now - ranAt} s ago`), ranAt) });
  }

  const stored = (results.checks !== null && typeof results.checks === 'object' ? results.checks : {}) as Record<string, unknown>;
  const checks: Record<string, CheckResult> = {};
  for (const name of Object.keys(config.checks)) {
    if (name === 'queue' || name === 'queue.release') continue; // evaluated together below
    if (name === 'scheduler') checks[name] = scheduler(store, commit, now, ranAt);
    else if (name === 'scheduler.release') checks[name] = schedulerRelease(store, commit, now);
    else if (stored[name] !== null && typeof stored[name] === 'object') checks[name] = fromStore(stored[name]);
    else checks[name] = at(pending(30, 'waiting for the next scheduled run'), now);
  }

  if (declares(config, 'queue') || declares(config, 'queue.release')) {
    const configResult = stored.queue !== null && typeof stored.queue === 'object' ? fromStore(stored.queue) : null;
    const [queueResult, release] = queue(store, commit, configResult, now);
    if (declares(config, 'queue')) checks.queue = queueResult;
    if (declares(config, 'queue.release')) checks['queue.release'] = release;
  }

  // Report order is the declared order.
  const ordered: Record<string, CheckResult> = {};
  for (const name of Object.keys(config.checks)) if (checks[name] !== undefined) ordered[name] = checks[name];
  return build(store, config, commit, ordered);
}

function beforeFirstRun(store: FileStore, config: Config, commit: string | null, now: number): FullReport {
  const boot = store.createIfAbsent(Store.boot(commit), { at: now });
  if (boot === null) {
    // Without a boot marker the scheduler's grace has no start, and a report
    // that stayed pending would hide a dead scheduler forever.
    return build(store, config, commit, { scheduler: at(fail('report_store_unwritable', 'the result store could not be written'), now) });
  }
  const bootedAt = Number.isInteger(boot.at) ? (boot.at as number) : now;
  const age = now - bootedAt;

  if (age > SCHEDULER_GRACE) {
    return build(store, config, commit, { scheduler: at(fail('scheduler_not_running', `no scheduled run for this release in ${age} s`), now) });
  }

  const retry = Math.max(5, Math.min(30, SCHEDULER_GRACE - age));
  const checks: Record<string, CheckResult> = {};
  for (const name of Object.keys(config.checks)) checks[name] = at(pending(retry, 'waiting for the first scheduled run'), now);
  if (Object.keys(checks).length === 0) checks.scheduler = at(pending(retry, 'waiting for the first scheduled run'), now);
  return build(store, config, commit, checks);
}

function scheduler(store: FileStore, commit: string | null, now: number, ranAt: number): CheckResult {
  const heartbeat = store.read(Store.heartbeat(commit));
  const beat = Number.isInteger(heartbeat?.at) ? (heartbeat!.at as number) : null;
  if (beat === null) return at(fail('scheduler_not_running', 'no heartbeat from this release'), ranAt);
  const age = Math.max(0, now - beat);
  if (age > SCHEDULER_GRACE) return at(fail('scheduler_not_running', `last heartbeat ${age} s ago`), beat);
  return at(pass(`last heartbeat ${age} s ago`), beat);
}

function schedulerRelease(store: FileStore, commit: string | null, now: number): CheckResult {
  const own = store.read(Store.heartbeat(commit));
  if (own === null) return at(pending(30, 'waiting for the first heartbeat'), now);
  const beat = Number.isInteger(own.at) ? (own.at as number) : now;

  // A minute in which either release took over may legitimately contain the other's run: the
  // minute a release first ran in, and the minute its process last started in (a rollback
  // restarts the process in a minute the release it replaces ran in). Both sides count: the
  // replaced release's last run is in the minute the new one took over.
  const takeover = (heartbeat: Record<string, unknown> | null): number[] =>
    [heartbeat?.first_minute, heartbeat?.started_minute].filter((m): m is number => Number.isInteger(m));
  const ownTakeover = takeover(own);
  const mine = (Array.isArray(own.minutes) ? own.minutes : []).filter((m): m is number => Number.isInteger(m) && !ownTakeover.includes(m));

  const ownName = Store.heartbeat(commit);
  for (const name of store.names('heartbeat-')) {
    if (name === ownName) continue;
    const other = store.read(name);
    const theirTakeover = takeover(other);
    const theirs = Array.isArray(other?.minutes) ? (other!.minutes as unknown[]) : [];
    if (mine.some((minute) => !theirTakeover.includes(minute) && theirs.includes(minute))) {
      return at(fail('scheduler_release_mismatch', 'heartbeats from more than one commit in the same minute'), beat);
    }
  }
  return at(pass('heartbeats in each minute come from one commit'), beat);
}

interface Probe {
  dispatched_at: number;
  answered_at?: number;
  worker_commit?: unknown;
}

/**
 * `queue` and `queue.release`, judged against this release's probes.
 *
 * Only probes dispatched after the newest answered probe count as
 * outstanding: a worker that answered a later probe is alive, so one probe
 * lost on the way (a failed or dropped job) does not fail the queue.
 */
function queue(store: FileStore, commit: string | null, config: CheckResult | null, now: number): [CheckResult, CheckResult] {
  const expected = config?.expected ?? null;
  const observed = config?.observed ?? null;

  if (config !== null && config.status === 'fail') {
    // The queue check itself failed (wrong backend, no dispatch): no probe can
    // say which release a worker runs, so the release is skipped.
    const checkedAt = config.checkedAt ?? now;
    return [{ ...config, checkedAt }, { status: 'skip', checkedAt }];
  }

  const probes: Probe[] = [];
  let answered: (Probe & { answered_at: number }) | null = null;
  for (const name of store.names(Store.probePrefix(commit))) {
    const probe = store.read(name);
    if (probe === null || !Number.isInteger(probe.dispatched_at)) continue;
    const p = probe as unknown as Probe;
    probes.push(p);
    if (
      Number.isInteger(p.answered_at) &&
      (answered === null ||
        p.dispatched_at > answered.dispatched_at ||
        (p.dispatched_at === answered.dispatched_at && (p.answered_at as number) > answered.answered_at))
    ) {
      answered = p as Probe & { answered_at: number };
    }
  }

  const outstanding = probes
    .filter((p) => !Number.isInteger(p.answered_at) && (answered === null || p.dispatched_at > answered.dispatched_at))
    .map((p) => p.dispatched_at);

  const oldest = outstanding.length === 0 ? null : Math.min(...outstanding);
  const oldestAge = oldest === null ? null : now - oldest;

  if (oldest !== null && oldestAge! > QUEUE_GRACE) {
    const detail = `oldest unanswered probe has waited ${oldestAge} s`;
    return [
      at(fail('queue_no_worker', detail, expected, observed), oldest),
      at(fail('queue_no_worker', detail), oldest),
    ];
  }

  if (answered === null) {
    const retry = oldestAge === null ? 30 : Math.max(5, Math.min(30, QUEUE_GRACE - oldestAge));
    const waiting = at(pending(retry, 'waiting for the first probe to be processed'), now);
    return [{ ...waiting, expected, observed }, waiting];
  }

  const answeredAt = answered.answered_at;
  const queueResult = at(pass(`latest probe answered after ${Math.max(0, answeredAt - answered.dispatched_at)} s`, expected, observed), answeredAt);
  const release =
    commit !== null && answered.worker_commit === Store.key(commit)
      ? at(pass('the worker runs this release'), answeredAt)
      : at(fail('queue_release_mismatch', 'the worker that answered the latest probe runs a different commit'), answeredAt);

  return [queueResult, release];
}

function build(store: FileStore, config: Config, commit: string | null, checks: Record<string, CheckResult>): FullReport {
  let settled = true;
  let status: 'pass' | 'warn' | 'fail' = 'pass';
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, check] of Object.entries(checks)) {
    if (check.status === 'pending') settled = false;
    if (check.status === 'fail') status = 'fail';
    else if ((check.status === 'warn' || check.status === 'pending') && status !== 'fail') status = 'warn';
    out[name] = toReport(check);
  }

  const boot = store.read(Store.boot(commit));
  return {
    status,
    deploy: {
      spec_version: '0.1',
      tier: 'full',
      settled,
      checks: out,
      app: app(config),
      release: {
        commit,
        booted_at: Number.isInteger(boot?.at) ? timestamp(boot!.at as number) : null,
        run_id_match: null,
      },
    },
  };
}

function app(config: Config): Record<string, string> {
  const app: Record<string, string> = {};
  if (config.appName !== null && /^[A-Za-z0-9 ._-]{1,64}$/.test(config.appName)) app.name = config.appName;
  const framework = nextVersion(config.root);
  if (framework !== null) app.framework = framework;
  const [major, minor] = process.versions.node.split('.');
  app.runtime = `node ${major}.${minor}`;
  if (config.double !== null && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(config.double)) app.double = config.double;
  return app;
}

/** `next major.minor` from the installed package, or null. */
function nextVersion(root: string): string | null {
  try {
    const { version } = JSON.parse(readFileSync(join(root, 'node_modules', 'next', 'package.json'), 'utf8')) as { version?: unknown };
    const match = typeof version === 'string' ? /^(\d+)\.(\d+)/.exec(version) : null;
    return match ? `next ${Number(match[1])}.${Number(match[2])}` : null;
  } catch {
    return null;
  }
}

function at(result: CheckResult, now: number): CheckResult {
  return { ...result, checkedAt: now };
}

export function epoch(): number {
  return Math.floor(Date.now() / 1000);
}
