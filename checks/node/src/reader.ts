import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { fail, fromStore, pending, pass, timestamp, toReport, type CheckResult } from './result.js';
import { FileStore, Store } from './store.js';
import type { FullReport } from './tier.js';

/** Results older than this mean the scheduler stopped: report only `scheduler: fail`. */
export const STALE_AFTER = 180;
/** No heartbeat for this long (from boot when there never was one) means no scheduler. */
export const SCHEDULER_GRACE = 120;

/**
 * Builds the full report from the result store — the same rules as
 * checks-php's ReportReader. It only reads: it never runs a check or touches
 * a backing service. The one write it may make is the release's boot marker,
 * once, when the store has none.
 */
export function readReport(store: FileStore, config: Config, commit: string | null, now: number = epoch()): FullReport {
  const results = store.read(Store.results(commit));

  if (results !== null) {
    const ranAt = Number.isInteger(results.ran_at) ? (results.ran_at as number) : 0;
    if (now - ranAt > STALE_AFTER) {
      return build(store, config, commit, { scheduler: at(fail('scheduler_results_stale', `last scheduled run ${now - ranAt} s ago`), now) });
    }
  } else {
    return beforeFirstRun(store, config, commit, now);
  }

  const stored = (results.checks !== null && typeof results.checks === 'object' ? results.checks : {}) as Record<string, unknown>;
  const checks: Record<string, CheckResult> = {};
  for (const name of Object.keys(config.checks)) {
    if (name === 'scheduler') checks[name] = scheduler(store, commit, now);
    else if (name === 'scheduler.release') checks[name] = schedulerRelease(store, commit, now);
    else if (stored[name] !== null && typeof stored[name] === 'object') checks[name] = fromStore(stored[name]);
    else checks[name] = at(pending(30, 'waiting for the next scheduled run'), now);
  }
  return build(store, config, commit, checks);
}

function beforeFirstRun(store: FileStore, config: Config, commit: string | null, now: number): FullReport {
  const boot = store.createIfAbsent(Store.boot(commit), { at: now });
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

function scheduler(store: FileStore, commit: string | null, now: number): CheckResult {
  const heartbeat = store.read(Store.heartbeat(commit));
  const beat = Number.isInteger(heartbeat?.at) ? (heartbeat!.at as number) : null;
  if (beat === null) return at(fail('scheduler_not_running', 'no heartbeat from this release'), now);
  const age = Math.max(0, now - beat);
  if (age > SCHEDULER_GRACE) return at(fail('scheduler_not_running', `last heartbeat ${age} s ago`), now);
  return at(pass(`last heartbeat ${age} s ago`), now);
}

function schedulerRelease(store: FileStore, commit: string | null, now: number): CheckResult {
  const own = store.read(Store.heartbeat(commit));
  if (own === null) return at(pending(30, 'waiting for the first heartbeat'), now);

  const first = Number.isInteger(own.first_minute) ? (own.first_minute as number) : null;
  // The minute this release took over may legitimately contain the previous release's last run.
  const mine = (Array.isArray(own.minutes) ? own.minutes : []).filter((m): m is number => Number.isInteger(m) && m !== first);

  const ownName = Store.heartbeat(commit);
  for (const name of store.names('heartbeat-')) {
    if (name === ownName) continue;
    const other = store.read(name);
    const theirs = Array.isArray(other?.minutes) ? (other!.minutes as unknown[]) : [];
    if (mine.some((minute) => theirs.includes(minute))) {
      return at(fail('scheduler_release_mismatch', 'heartbeats from more than one commit in the same minute'), now);
    }
  }
  return at(pass('heartbeats in each minute come from one commit'), now);
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
