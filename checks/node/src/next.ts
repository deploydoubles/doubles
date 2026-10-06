import { nodeChecks, type DatabaseClient } from './checks.js';
import { resolveCommit } from './commit.js';
import { loadConfig } from './config.js';
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
}

/** Runs the declared checks once and stores the results. */
export async function runDeployReport(options: DeployReportOptions = {}): Promise<void> {
  const root = options.root ?? process.cwd();
  const config = loadConfig(root);
  const commit = resolveCommit(root);
  await runChecks(new FileStore(config.storePath), config, commit, nodeChecks(config, commit, options.database), {
    warn: (message) => console.warn(`deploy-report: ${message}`),
  });
}

const SCHEDULER = Symbol.for('deploydoubles.checks.scheduler');
export const INTERVAL_MS = 60_000;

/**
 * Starts the in-process scheduler: one run now, then one every 60 s. Call it
 * from `register()` in `instrumentation.ts`. One timer per process, whatever
 * calls it how often; the store's writes are atomic, so processes may overlap.
 */
export function startDeployReport(options: DeployReportOptions = {}): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const state = globalThis as typeof globalThis & { [SCHEDULER]?: NodeJS.Timeout };
  if (state[SCHEDULER]) return;

  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    runDeployReport(options)
      .catch(() => console.warn('deploy-report: the scheduled run failed'))
      .finally(() => {
        running = false;
      });
  };

  tick();
  state[SCHEDULER] = setInterval(tick, INTERVAL_MS);
  state[SCHEDULER].unref();
}

/** Stops the scheduler started by startDeployReport (tests, graceful shutdown). */
export function stopDeployReport(): void {
  const state = globalThis as typeof globalThis & { [SCHEDULER]?: NodeJS.Timeout };
  if (state[SCHEDULER]) clearInterval(state[SCHEDULER]);
  delete state[SCHEDULER];
}
