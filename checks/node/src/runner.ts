import { declares, type Config } from './config.js';
import { mapError } from './errors.js';
import { epoch } from './reader.js';
import { fail, toStore, type CheckResult } from './result.js';
import { FileStore, Store } from './store.js';
import { configurationWarning } from './tier.js';
import type { Check } from './checks.js';

/** Checks whose result is produced by the scheduled run itself (as in checks-php). */
export const RUN_TIME_CHECKS = ['database', 'cache', 'queue', 'storage', 'assets', 'env'] as const;

const MINUTES_KEPT = 5;
const OTHER_RELEASE_TTL = 3600;

/**
 * The scheduled run: executes the declared checks, writes their results and
 * a heartbeat to the store. The in-process scheduler calls it every minute.
 */
export async function runChecks(
  store: FileStore,
  config: Config,
  commit: string | null,
  checks: Record<string, Check>,
  options: { now?: number; warn?: (message: string) => void } = {},
): Promise<Record<string, CheckResult>> {
  const now = options.now ?? epoch();
  store.createIfAbsent(Store.boot(commit), { at: now });

  const warning = configurationWarning(config);
  if (warning !== null) options.warn?.(warning);

  const results: Record<string, CheckResult> = {};
  for (const name of RUN_TIME_CHECKS) {
    if (!declares(config, name)) continue;
    const check = checks[name];
    if (!check) {
      results[name] = { status: 'skip', checkedAt: now };
      continue;
    }
    try {
      results[name] = { ...(await check()), checkedAt: now };
    } catch (error) {
      results[name] = { ...fail(mapError(name, error)), checkedAt: now };
    }
  }

  store.write(Store.results(commit), {
    commit: Store.key(commit),
    ran_at: now,
    checks: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, toStore(result)])),
  });
  heartbeat(store, commit, now);
  prune(store, commit, now);

  return results;
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
  const key = Store.key(commit);
  for (const [prefix, field] of [['results-', 'ran_at'], ['heartbeat-', 'at'], ['boot-', 'at']] as const) {
    for (const name of store.names(prefix)) {
      if (name === prefix + key) continue;
      const data = store.read(name);
      if (!Number.isInteger(data?.[field]) || now - (data![field] as number) > OTHER_RELEASE_TTL) store.delete(name);
    }
  }
}
