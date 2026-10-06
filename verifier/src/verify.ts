import { HINTS, codeHint } from './hints.js';
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
const OVERALL: ReadonlySet<string> = new Set(['pass', 'warn', 'fail']);
/** spec/schema/report-v0.1.json, $defs.checkName. */
const CHECK_NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/;
const INVALID_NAME = 'invalid_check_name';
const COMMIT = /^[0-9a-f]{7,64}$/;
/** spec/schema/report-v0.1.json, $defs.timestamp (RFC 3339). */
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/;

export function commitMatches(expected: string, served: string | null | undefined): boolean {
  if (typeof served !== 'string' || served === '') return false;
  const want = expected.trim().toLowerCase();
  const have = served.trim().toLowerCase();
  if (want.length < 7) return false;
  return have === want || (want.length < have.length && have.startsWith(want));
}

/** The served commit, only when it is a hex sha: anything else is remote text and is never kept. */
function servedCommit(report: DeployReport): string | null {
  const commit = report.deploy.release?.commit;
  if (typeof commit !== 'string') return null;
  const lower = commit.trim().toLowerCase();
  return COMMIT.test(lower) ? lower : null;
}

/**
 * The inside checks, in the verifier's own words: names are checked against the specification's
 * pattern, hints come from the verifier's fixed table by code. Nothing of the report's free text
 * survives.
 */
function insideChecks(report: DeployReport): { checks: CheckOutcome[]; invalidNames: number } {
  const checks = report.deploy.checks ?? {};
  const fullTier = report.deploy.tier === 'full';
  let invalidNames = 0;
  const outcomes = Object.entries(checks).map(([rawName, check]) => {
    let name = rawName;
    if (rawName.length > 64 || !CHECK_NAME.test(rawName)) {
      invalidNames++;
      name = invalidNames === 1 ? INVALID_NAME : `${INVALID_NAME}_${invalidNames}`;
    }
    const raw = typeof check?.status === 'string' ? check.status : 'fail';
    const status = (STATUSES.has(raw) ? raw : 'fail') as CheckStatus;
    const outcome: CheckOutcome = { name, status };
    if (status === 'fail' || status === 'pending' || status === 'warn') {
      outcome.hint =
        codeHint(check?.code) ?? (status === 'pending' ? HINTS.pending : fullTier ? HINTS.unknownCode : HINTS.publicTier);
    }
    return outcome;
  });
  return { checks: outcomes, invalidNames };
}

/** The newest `checked_at` in the report, in ms truncated to whole seconds, or null when no check carries one. */
function newestCheckedAt(report: DeployReport): number | null {
  let newest: number | null = null;
  for (const check of Object.values(report.deploy.checks ?? {})) {
    const at = typeof check?.checked_at === 'string' && TIMESTAMP.test(check.checked_at) ? Date.parse(check.checked_at) : NaN;
    if (Number.isFinite(at)) newest = Math.max(newest ?? -Infinity, Math.floor(at / 1000) * 1000);
  }
  return newest;
}

/**
 * Whether the report's overall status, its HTTP status and its checks agree, and its names follow
 * the specification. A report that disagrees with itself is ambiguous, and ambiguity is never a pass.
 */
function consistent(report: DeployReport, httpStatus: number, inside: CheckOutcome[], invalidNames: number): boolean {
  const status = report.status;
  if (!OVERALL.has(status) || invalidNames > 0) return false;
  if (httpStatus !== (status === 'fail' ? 503 : 200)) return false;
  return (status === 'fail') === inside.some((c) => c.status === 'fail');
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
): Promise<{ downtime: Downtime; switched: boolean; switchedAt: number | null; last: ReportFetch | null }> {
  const target = reportUrl(options.url);
  const start = deps.now();
  let lastSuccess = start;
  let longestGap = 0;
  let requests = 0;
  let failed = 0;
  let oldSeen = false;
  let switched = false;
  let switchedAt: number | null = null;
  let last: ReportFetch | null = null;
  const inFlight = new Set<Promise<void>>();

  while (!switched && deps.now() < deadline) {
    requests++;
    const request = fetchReport(deps.fetch, target, { token: options.token, runId: options.runId, timeoutMs: 5_000 }).then(
      (result) => {
        last = result;
        if (result.kind === 'report') {
          const at = deps.now();
          longestGap = Math.max(longestGap, at - lastSuccess);
          lastSuccess = Math.max(lastSuccess, at);
          if (commitMatches(options.commit, servedCommit(result.report))) {
            if (!switched) switchedAt = result.serverTime ?? deps.now();
            switched = true;
          } else {
            oldSeen = true;
          }
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

  return {
    downtime: { requests, failed, longest_gap_ms: Math.round(longestGap), old_release_seen: oldSeen },
    switched,
    switchedAt,
    last,
  };
}

function downtimeOutcome(measured: Awaited<ReturnType<typeof measureDowntime>>): CheckOutcome {
  if (measured.downtime.failed > 0) return { name: 'downtime', status: 'fail', hint: HINTS.downtime };
  if (!measured.switched) return { name: 'downtime', status: 'pending', hint: HINTS.pending };
  // Without a single answer from the old release, nothing was measured: the switch happened before we looked.
  if (!measured.downtime.old_release_seen) return { name: 'downtime', status: 'pending', hint: HINTS.noSwitchSeen };
  return { name: 'downtime', status: 'pass' };
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
    fresh: false,
    reportStatus: null,
    httpStatus: null,
    runIdRequested: Boolean(options.runId),
  };

  /** When the expected commit was first seen serving, on the server's clock when it sent a Date header. */
  let firstSeenAt: number | null = null;
  let downtime: CheckOutcome | null = null;
  if (options.duringDeploy) {
    const measured = await measureDowntime(options, deps, deadline);
    result.downtime = measured.downtime;
    firstSeenAt = measured.switchedAt;
    downtime = downtimeOutcome(measured);
  }

  let tlsFailed = false;
  let crossOrigin = false;
  let last: Extract<ReportFetch, { kind: 'report' }> | null = null;

  for (;;) {
    const fetched = await fetchReport(deps.fetch, target, { token: options.token, runId: options.runId });
    if (fetched.kind === 'report') {
      last = fetched;
      result.reachable = true;
      const served = servedCommit(fetched.report);
      result.servedCommit = served;
      const matches = commitMatches(options.commit, served);
      if (matches && firstSeenAt === null) firstSeenAt = fetched.serverTime ?? Math.floor(deps.now() / 1000) * 1000;
      const newest = newestCheckedAt(fetched.report);
      result.settled = fetched.report.deploy.settled === true;
      // A settled report counts only when its evidence is no older than our first sight of the release.
      result.fresh = matches && firstSeenAt !== null && newest !== null && newest >= firstSeenAt;
      if (result.settled && result.fresh) break;
    } else if (fetched.kind === 'tls-error') {
      tlsFailed = true;
    } else if (fetched.kind === 'cross-origin-redirect') {
      crossOrigin = true;
    }

    const remaining = deadline - deps.now();
    if (remaining <= 0) break;
    await deps.sleep(nextDelay(last?.report ?? null, remaining));
  }

  outside.push(
    result.reachable
      ? { name: 'reachability', status: 'pass' }
      : { name: 'reachability', status: 'fail', hint: crossOrigin ? HINTS.crossOriginRedirect : HINTS.unreachable },
  );

  if (appliesTlsChecks(target)) {
    outside.push(tlsFailed && !result.reachable ? { name: 'tls', status: 'fail', hint: HINTS.tls } : { name: 'tls', status: result.reachable ? 'pass' : 'skip' });
    outside.push(await checkHttpsRedirect(deps.fetch, target));
  } else {
    outside.push({ name: 'tls', status: 'skip' }, { name: 'https_redirect', status: 'skip' });
  }

  if (last) {
    const { checks, invalidNames } = insideChecks(last.report);
    result.inside = checks;
    result.reportStatus = last.report.status;
    result.httpStatus = last.httpStatus;
    const releaseMatches = commitMatches(options.commit, result.servedCommit);
    if (releaseMatches) {
      outside.push({ name: 'release', status: 'pass' });
    } else {
      const raw = last.report.deploy.release?.commit;
      outside.push({ name: 'release', status: 'fail', hint: typeof raw === 'string' && result.servedCommit !== null ? HINTS.wrongRelease : HINTS.unknownRelease });
    }
    if (options.runId) {
      // Compared only when a run ID was given.
      const match = last.report.deploy.release?.run_id_match;
      outside.push(match === true ? { name: 'run_id', status: 'pass' } : { name: 'run_id', status: 'fail', hint: HINTS.runId });
    }
    if (!consistent(last.report, last.httpStatus, checks, invalidNames)) {
      outside.push({ name: 'report', status: 'fail', hint: HINTS.inconsistent });
    } else if (releaseMatches && !result.fresh) {
      outside.push({ name: 'report', status: 'pending', hint: HINTS.notFresh });
    } else {
      outside.push({ name: 'report', status: 'pass' });
    }
  } else {
    outside.push({ name: 'release', status: 'fail', hint: crossOrigin ? HINTS.crossOriginRedirect : HINTS.unreachable });
    if (options.runId) outside.push({ name: 'run_id', status: 'fail', hint: HINTS.unreachable });
  }

  if (downtime) outside.push(downtime);

  return result;
}
