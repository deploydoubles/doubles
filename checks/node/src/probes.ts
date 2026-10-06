import { randomBytes } from 'node:crypto';
import { FileStore, Store } from './store.js';

const PROBE_NAME = /^probe-[a-z0-9]+-[0-9a-f]{16}$/;

/**
 * Queue probes, as in checks-php (src/Probes.php): recorded when the
 * scheduled run dispatches one, answered by the worker that processes it.
 */
export function newProbeId(): string {
  return randomBytes(8).toString('hex');
}

export function recordProbe(store: FileStore, commit: string | null, id: string, now: number): void {
  store.write(Store.probe(commit, id), { id, commit: Store.key(commit), dispatched_at: now });
}

/**
 * Called by the worker. `probe` is the store name the job carries;
 * `workerCommit` is resolved by the worker when it handles the job.
 */
export function answerProbe(store: FileStore, probe: string, workerCommit: string | null, now: number): void {
  if (!PROBE_NAME.test(probe)) return;
  const record = store.read(probe);
  if (record === null || record.answered_at != null) return;
  store.write(probe, { ...record, answered_at: now, worker_commit: Store.key(workerCommit) });
}
