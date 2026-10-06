import { isTlsError } from './net.js';
import type { DeployReport } from './types.js';

export type Fetch = typeof globalThis.fetch;

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

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

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
  let target = url;
  let response: Response | undefined;
  try {
    for (let hop = 0; ; hop++) {
      response = await fetchImpl(target, { headers, redirect: 'manual', signal });
      if (!REDIRECTS.has(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location || hop >= MAX_REDIRECTS) return { kind: 'not-report', httpStatus: response.status };
      let next: URL;
      try {
        next = new URL(location, target);
      } catch {
        return { kind: 'not-report', httpStatus: response.status };
      }
      if (next.origin !== url.origin) return { kind: 'cross-origin-redirect', httpStatus: response.status };
      target = next;
    }
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
