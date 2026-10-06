import { CHECK_TIMEOUT_MS, nodeChecks, type DatabaseClient } from './checks.js';
import { resolveCommit } from './commit.js';
import { loadConfig } from './config.js';
import { answerProbe } from './probes.js';
import { readReport } from './reader.js';
import { runChecks } from './runner.js';
import { FileStore } from './store.js';
import { applyTier, decideTier, runIdMatch, RUN_ID_HEADER } from './tier.js';

export const REPORT_PATH = '/.well-known/deploy-report';

/**
 * The route handler for `app/.well-known/deploy-report/route.ts`. It only
 * reads the store and filters by tier: no checks, no database access.
 */
export function createDeployReportHandler(options: { root?: string } = {}): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const root = options.root ?? process.cwd();
    const config = loadConfig(root);
    const commit = resolveCommit(root);
    const report = readReport(new FileStore(config.storePath), config, commit);
    const body = applyTier(
      report,
      decideTier(config, request.headers.get('authorization')),
      runIdMatch(config.runId, request.headers.get(RUN_ID_HEADER)),
    );

    return new Response(JSON.stringify(body), {
      status: report.status === 'fail' ? 503 : 200,
      headers: { 'content-type': 'application/health+json', 'cache-control': 'no-store' },
    });
  };
}

export const GET = createDeployReportHandler();

export interface DeployReportOptions {
  /** A factory for a fresh node-postgres-compatible client; called once per run, never per request. */
  database?: () => DatabaseClient;
  /** The app root (default: the working directory). */
  root?: string;
  /**
   * For an app with a queue worker that declares `queue`: dispatches a job
   * carrying this probe name. The job calls answerDeployReportProbe(probe).
   */
  dispatchProbe?: (probe: string) => void | Promise<void>;
  /**
   * Bounds, for tests: one check's database work (default 10 s), one whole
   * scheduled run (default 45 s) and the interval between runs (default 60 s).
   */
  timing?: { checkTimeoutMs?: number; runTimeoutMs?: number; intervalMs?: number };
}

/** Runs the declared checks once and stores the results. */
export async function runDeployReport(options: DeployReportOptions = {}): Promise<void> {
  const root = options.root ?? process.cwd();
  const config = loadConfig(root);
  const commit = resolveCommit(root);
  const checks = nodeChecks(config, commit, options.database, options.timing?.checkTimeoutMs ?? CHECK_TIMEOUT_MS);
  await runChecks(new FileStore(config.storePath), config, commit, checks, {
    warn: (message) => console.warn(`deploy-report: ${message}`),
    ...(options.dispatchProbe ? { dispatchProbe: options.dispatchProbe } : {}),
  });
}

/** Answers a queue probe from the worker that processed it, with the worker's own commit. */
export function answerDeployReportProbe(probe: string, options: { root?: string } = {}): void {
  const root = options.root ?? process.cwd();
  answerProbe(new FileStore(loadConfig(root).storePath), probe, resolveCommit(root), Math.floor(Date.now() / 1000));
}

const SCHEDULER = Symbol.for('deploydoubles.checks.scheduler');
export const INTERVAL_MS = 60_000;
/** The bound on one scheduled run; past it the next tick may start, whatever the run is waiting on. */
export const RUN_TIMEOUT_MS = 45_000;

/**
 * Starts the in-process scheduler: one run now, then one every 60 s. Call it
 * from `register()` in `instrumentation.ts`. One timer per process, whatever
 * calls it how often; the store's writes are atomic, so processes may overlap.
 */
export function startDeployReport(options: DeployReportOptions = {}): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const state = globalThis as typeof globalThis & { [SCHEDULER]?: NodeJS.Timeout };
  if (state[SCHEDULER]) return;

  const runTimeoutMs = options.timing?.runTimeoutMs ?? RUN_TIMEOUT_MS;
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    within(runDeployReport(options), runTimeoutMs)
      .catch((error: unknown) =>
        console.warn(error === RUN_TIMED_OUT ? 'deploy-report: the scheduled run did not finish in time' : 'deploy-report: the scheduled run failed'),
      )
      .finally(() => {
        running = false;
      });
  };

  tick();
  state[SCHEDULER] = setInterval(tick, options.timing?.intervalMs ?? INTERVAL_MS);
  state[SCHEDULER].unref();
}

const RUN_TIMED_OUT = Symbol('run timed out');

/** Settles with the promise, or rejects with RUN_TIMED_OUT after `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(RUN_TIMED_OUT), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Stops the scheduler started by startDeployReport (tests, graceful shutdown). */
export function stopDeployReport(): void {
  const state = globalThis as typeof globalThis & { [SCHEDULER]?: NodeJS.Timeout };
  if (state[SCHEDULER]) clearInterval(state[SCHEDULER]);
  delete state[SCHEDULER];
}
