import { declares, type Config } from './config.js';
import { mapError } from './errors.js';
import { newProbeId, recordProbe } from './probes.js';
import { epoch, STALE_AFTER } from './reader.js';
import { fail, toStore, type CheckResult } from './result.js';
import { FileStore, Store } from './store.js';
import { configurationWarning } from './tier.js';
import type { Check } from './checks.js';

/** Checks whose result is produced by the scheduled run itself (as in checks-php). */
export const RUN_TIME_CHECKS = ['database', 'cache', 'queue', 'storage', 'assets', 'env'] as const;

const MINUTES_KEPT = 5;
const PROBE_TTL = 900;
const OTHER_RELEASE_TTL = 3600;

/**
 * A release whose last run is older than this (more than one missed minute),
 * while another release started in between, has come back: a rollback or a
 * redeploy of a commit that ran before.
 */
const RETURN_GAP = 90;

export interface RunOptions {
  now?: number;
  /** Receives configuration warnings and the class of a check error — never a message or a secret. */
  warn?: (message: string) => void;
  /** Dispatches a probe job carrying the probe's store name; the worker answers it with answerProbe. */
  dispatchProbe?: (probe: string) => void | Promise<void>;
}

/**
 * The scheduled run: executes the declared checks, writes their results and
 * a heartbeat to the store, and dispatches one queue probe when the app has a
 * worker. The in-process scheduler calls it every minute. The same rules as
 * checks-php's Runner.
 */
export async function runChecks(
  store: FileStore,
  config: Config,
  commit: string | null,
  checks: Record<string, Check>,
  options: RunOptions = {},
): Promise<Record<string, CheckResult>> {
  const now = options.now ?? epoch();
  let previous = store.read(Store.results(commit));
  if (isReturning(store, commit, previous, now)) {
    forgetEarlierLife(store, commit);
    previous = null;
  }
  const since = Number.isInteger(previous?.since) ? (previous!.since as number) : now;
  store.createIfAbsent(Store.boot(commit), { at: now });

  const warning = configurationWarning(config);
  if (warning !== null) options.warn?.(warning);

  const results: Record<string, CheckResult> = {};
  for (const name of RUN_TIME_CHECKS) {
    if (!declares(config, name) && !(name === 'queue' && declares(config, 'queue.release'))) continue;
    const check = checks[name];
    if (!check) {
      results[name] = { status: 'skip', checkedAt: now };
      continue;
    }
    try {
      results[name] = { ...(await check()), checkedAt: now };
    } catch (error) {
      results[name] = { ...fail(mapError(name, error)), checkedAt: now };
      reportError(options.warn, name, error);
    }
  }

  const queue = results.queue;
  if (queue !== undefined && queue.status !== 'fail' && options.dispatchProbe) {
    const id = newProbeId();
    try {
      recordProbe(store, commit, id, now);
      await options.dispatchProbe(Store.probe(commit, id));
    } catch (error) {
      store.delete(Store.probe(commit, id));
      results.queue = { ...fail('queue_error', 'the probe job could not be dispatched', queue.expected, queue.observed), checkedAt: now };
      reportError(options.warn, 'queue', error);
    }
  }

  store.write(Store.results(commit), {
    commit: Store.key(commit),
    since,
    ran_at: now,
    checks: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, toStore(result)])),
  });
  heartbeat(store, commit, now);
  prune(store, commit, now);

  return results;
}

/**
 * Whether the stored state for this commit belongs to an earlier life of the
 * release: a rollback to it, or a redeploy of it. Its results, probes,
 * heartbeat and boot marker then describe a different deployment and must not
 * be read as this one's.
 */
function isReturning(store: FileStore, commit: string | null, results: Record<string, unknown> | null, now: number): boolean {
  if (results !== null) {
    const ranAt = Number.isInteger(results.ran_at) ? (results.ran_at as number) : 0;
    if (now - ranAt > STALE_AFTER) return true;
    if (now - ranAt <= RETURN_GAP) return false;
    // Another release started after this one last ran: it was replaced, and is back.
    const own = Store.results(commit);
    for (const name of store.names('results-')) {
      if (name === own) continue;
      const since = store.read(name)?.since;
      if (Number.isInteger(since) && (since as number) > ranAt) return true;
    }
    return false;
  }

  // No results, but state left over from an earlier life of this commit.
  if (store.read(Store.heartbeat(commit)) !== null || store.names(Store.probePrefix(commit)).length > 0) return true;
  const boot = store.read(Store.boot(commit));
  return Number.isInteger(boot?.at) && now - (boot!.at as number) > STALE_AFTER;
}

/** Clears this commit's heartbeat (and with it the takeover minute), probes and boot marker. */
function forgetEarlierLife(store: FileStore, commit: string | null): void {
  store.delete(Store.heartbeat(commit));
  store.delete(Store.boot(commit));
  for (const name of store.names(Store.probePrefix(commit))) store.delete(name);
}

/** Hands the error's class — never its message — to the warn hook, so "check the app's logs" is true. */
function reportError(warn: ((message: string) => void) | undefined, check: string, error: unknown): void {
  warn?.(`the ${check} check failed with ${errorClass(error)}.`);
}

/** The error's class name, or its type for a thrown non-object. Never its message. */
export function errorClass(error: unknown): string {
  if (error === null || typeof error !== 'object') return typeof error;
  const name: unknown = (error as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(name) ? name : 'Object';
}

function heartbeat(store: FileStore, commit: string | null, now: number): void {
  const name = Store.heartbeat(commit);
  const previous = store.read(name) ?? {};
  const minute = Math.floor(now / 60);
  const minutes = (Array.isArray(previous.minutes) ? previous.minutes : []).filter((m): m is number => Number.isInteger(m));
  minutes.push(minute);
  store.write(name, {
    commit: Store.key(commit),
    at: now,
    first_minute: Number.isInteger(previous.first_minute) ? previous.first_minute : minute,
    minutes: [...new Set(minutes)].slice(-MINUTES_KEPT),
  });
}

function prune(store: FileStore, commit: string | null, now: number): void {
  for (const name of store.names('probe-')) {
    const dispatchedAt = store.read(name)?.dispatched_at;
    if (!Number.isInteger(dispatchedAt) || now - (dispatchedAt as number) > PROBE_TTL) store.delete(name);
  }

  const key = Store.key(commit);
  for (const [prefix, field] of [['results-', 'ran_at'], ['heartbeat-', 'at'], ['boot-', 'at']] as const) {
    for (const name of store.names(prefix)) {
      if (name === prefix + key) continue;
      const data = store.read(name);
      if (!Number.isInteger(data?.[field]) || now - (data![field] as number) > OTHER_RELEASE_TTL) store.delete(name);
    }
  }
}
