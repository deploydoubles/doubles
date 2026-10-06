import { HINTS } from './hints.js';
import { appliesTlsChecks, reportUrl } from './net.js';
import { fetchReport, type Fetch, type ReportFetch } from './report.js';
import type { CheckOutcome, CheckStatus, DeployReport, Downtime, VerifyResult } from './types.js';

export interface VerifyOptions {
  url: string;
  commit: string;
  runId?: string;
  token?: string;
  timeoutSeconds: number;
  duringDeploy?: boolean;
}

export interface Deps {
  fetch: Fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Interval of the --during-deploy request stream. */
  streamIntervalMs: number;
}

export const defaultDeps: Deps = {
  fetch: globalThis.fetch.bind(globalThis),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  streamIntervalMs: 250,
};

const DEFAULT_POLL_MS = 2_000;
const MAX_POLL_MS = 10_000;
const STATUSES: ReadonlySet<string> = new Set(['pass', 'warn', 'fail', 'pending', 'skip']);

export function commitMatches(expected: string, served: string | null | undefined): boolean {
  if (typeof served !== 'string' || served === '') return false;
  const want = expected.trim().toLowerCase();
  const have = served.trim().toLowerCase();
  if (want.length < 7) return false;
  return have === want || (want.length < have.length && have.startsWith(want));
}

function insideChecks(report: DeployReport): CheckOutcome[] {
  const checks = report.deploy.checks ?? {};
  const fullTier = report.deploy.tier === 'full';
  return Object.entries(checks).map(([name, check]) => {
    const raw = typeof check?.status === 'string' ? check.status : 'fail';
    const status = (STATUSES.has(raw) ? raw : 'fail') as CheckStatus;
    const outcome: CheckOutcome = { name, status };
    if (status === 'fail' || status === 'pending' || status === 'warn') {
      const hint = typeof check?.hint === 'string' ? check.hint : undefined;
      outcome.hint = hint ?? (status === 'pending' ? HINTS.pending : fullTier ? undefined : HINTS.publicTier);
    }
    return outcome;
  });
}

function nextDelay(report: DeployReport | null, remainingMs: number): number {
  let delay = DEFAULT_POLL_MS;
  const retries = Object.values(report?.deploy.checks ?? {})
    .map((c) => c?.retry_after)
    .filter((r): r is number => typeof r === 'number' && r > 0);
  if (retries.length > 0) delay = Math.min(...retries) * 1000;
  return Math.max(0, Math.min(delay, MAX_POLL_MS, remainingMs));
}

async function checkHttpsRedirect(fetchImpl: Fetch, url: URL): Promise<CheckOutcome> {
  const http = new URL(url.toString());
  http.protocol = 'http:';
  http.port = '';
  try {
    const response = await fetchImpl(http, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const location = response.headers.get('location') ?? '';
    if ([301, 302, 303, 307, 308].includes(response.status) && location.startsWith('https://')) {
      return { name: 'https_redirect', status: 'pass' };
    }
  } catch {
    // fall through: no redirect observed
  }
  return { name: 'https_redirect', status: 'fail', hint: HINTS.httpsRedirect };
}

/** Sends a steady request stream until the expected commit serves; counts failures and the longest gap. */
export async function measureDowntime(
  options: VerifyOptions,
  deps: Deps,
  deadline: number,
): Promise<{ downtime: Downtime; switched: boolean; last: ReportFetch | null }> {
  const target = reportUrl(options.url);
  const start = deps.now();
  let lastSuccess = start;
  let longestGap = 0;
  let failed = 0;
  let switched = false;
  let last: ReportFetch | null = null;
  const inFlight = new Set<Promise<void>>();

  while (!switched && deps.now() < deadline) {
    const request = fetchReport(deps.fetch, target, { token: options.token, runId: options.runId, timeoutMs: 5_000 }).then(
      (result) => {
        last = result;
        if (result.kind === 'report') {
          const at = deps.now();
          longestGap = Math.max(longestGap, at - lastSuccess);
          lastSuccess = Math.max(lastSuccess, at);
          if (commitMatches(options.commit, result.report.deploy.release?.commit)) switched = true;
        } else {
          failed++;
        }
      },
    );
    inFlight.add(request);
    void request.finally(() => inFlight.delete(request));
    await deps.sleep(deps.streamIntervalMs);
  }
  await Promise.all(inFlight);

  return { downtime: { failed, longest_gap_ms: Math.round(longestGap) }, switched, last };
}

export async function verify(options: VerifyOptions, deps: Deps = defaultDeps): Promise<VerifyResult> {
  const target = reportUrl(options.url);
  const deadline = deps.now() + options.timeoutSeconds * 1000;
  const outside: CheckOutcome[] = [];
  const result: VerifyResult = {
    url: options.url,
    commit: options.commit,
    servedCommit: null,
    reachable: false,
    outside,
    inside: [],
    settled: false,
    runIdRequested: Boolean(options.runId),
  };

  if (options.duringDeploy) {
    const measured = await measureDowntime(options, deps, deadline);
    result.downtime = measured.downtime;
    outside.push(
      measured.downtime.failed > 0
        ? { name: 'downtime', status: 'fail', hint: HINTS.downtime }
        : { name: 'downtime', status: measured.switched ? 'pass' : 'pending' },
    );
  }

  let tlsFailed = false;
  let last: DeployReport | null = null;

  for (;;) {
    const fetched = await fetchReport(deps.fetch, target, { token: options.token, runId: options.runId });
    if (fetched.kind === 'report') {
      last = fetched.report;
      result.reachable = true;
      const served = fetched.report.deploy.release?.commit ?? null;
      result.servedCommit = typeof served === 'string' ? served : null;
      result.settled = fetched.report.deploy.settled === true;
      if (result.settled && commitMatches(options.commit, served)) break;
    } else if (fetched.kind === 'tls-error') {
      tlsFailed = true;
    }

    const remaining = deadline - deps.now();
    if (remaining <= 0) break;
    await deps.sleep(nextDelay(last, remaining));
  }

  outside.unshift(
    result.reachable ? { name: 'reachability', status: 'pass' } : { name: 'reachability', status: 'fail', hint: HINTS.unreachable },
  );

  if (appliesTlsChecks(target)) {
    outside.push(tlsFailed && !result.reachable ? { name: 'tls', status: 'fail', hint: HINTS.tls } : { name: 'tls', status: result.reachable ? 'pass' : 'skip' });
    outside.push(await checkHttpsRedirect(deps.fetch, target));
  } else {
    outside.push({ name: 'tls', status: 'skip' }, { name: 'https_redirect', status: 'skip' });
  }

  if (last) {
    result.inside = insideChecks(last);
    const served = last.deploy.release?.commit;
    if (commitMatches(options.commit, served)) {
      outside.push({ name: 'release', status: 'pass' });
    } else {
      outside.push({ name: 'release', status: 'fail', hint: typeof served === 'string' ? HINTS.wrongRelease : HINTS.unknownRelease });
    }
    if (options.runId) {
      // Compared only when a run ID was given.
      const match = last.deploy.release?.run_id_match;
      outside.push(match === true ? { name: 'run_id', status: 'pass' } : { name: 'run_id', status: 'fail', hint: HINTS.runId });
    }
  } else {
    outside.push({ name: 'release', status: 'fail', hint: HINTS.unreachable });
    if (options.runId) outside.push({ name: 'run_id', status: 'fail', hint: HINTS.unreachable });
  }

  return result;
}

