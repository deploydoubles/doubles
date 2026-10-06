import { fetchSameOrigin, isTlsError, type Fetch } from './net.js';
import type { DeployReport } from './types.js';

export type { Fetch } from './net.js';

export type ReportFetch =
  /** serverTime: the response's Date header (ms, whole seconds), or null without one. */
  | { kind: 'report'; httpStatus: number; report: DeployReport; serverTime: number | null }
  | { kind: 'not-report'; httpStatus: number }
  /** The report URL redirected to another origin; it was not followed. */
  | { kind: 'cross-origin-redirect'; httpStatus: number }
  | { kind: 'tls-error' }
  | { kind: 'network-error' };

export interface RequestOptions {
  token?: string;
  runId?: string;
  timeoutMs?: number;
}

/** A response counts as a report when it is JSON with a top-level status and a deploy object. */
export function parseReport(body: string): DeployReport | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as { status?: unknown; deploy?: unknown };
  if (typeof candidate.status !== 'string') return null;
  if (typeof candidate.deploy !== 'object' || candidate.deploy === null) return null;
  return candidate as DeployReport;
}

function serverTime(response: Response): number | null {
  const date = Date.parse(response.headers.get('date') ?? '');
  return Number.isFinite(date) ? Math.floor(date / 1000) * 1000 : null;
}

/**
 * Fetches the report. Redirects are followed only within the same origin, so the token and the
 * run ID are never sent anywhere but the origin the caller named.
 */
export async function fetchReport(fetchImpl: Fetch, url: URL, options: RequestOptions): Promise<ReportFetch> {
  const headers: Record<string, string> = { accept: 'application/health+json, application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.runId) headers['deploy-run-id'] = options.runId;

  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  let response: Response;
  try {
    const fetched = await fetchSameOrigin(fetchImpl, url, { headers, signal });
    if (fetched.kind === 'cross-origin-redirect') return { kind: 'cross-origin-redirect', httpStatus: fetched.httpStatus };
    if (fetched.kind === 'bad-redirect') return { kind: 'not-report', httpStatus: fetched.httpStatus };
    response = fetched.response;
  } catch (error) {
    return isTlsError(error) ? { kind: 'tls-error' } : { kind: 'network-error' };
  }

  let body = '';
  try {
    body = await response.text();
  } catch {
    return { kind: 'network-error' };
  }
  const report = parseReport(body);
  return report
    ? { kind: 'report', httpStatus: response.status, report, serverTime: serverTime(response) }
    : { kind: 'not-report', httpStatus: response.status };
}
