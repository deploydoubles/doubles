import { isTlsError } from './net.js';
import type { DeployReport } from './types.js';

export type Fetch = typeof globalThis.fetch;

export type ReportFetch =
  | { kind: 'report'; httpStatus: number; report: DeployReport }
  | { kind: 'not-report'; httpStatus: number }
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

export async function fetchReport(fetchImpl: Fetch, url: URL, options: RequestOptions): Promise<ReportFetch> {
  const headers: Record<string, string> = { accept: 'application/health+json, application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.runId) headers['deploy-run-id'] = options.runId;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
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
  return report ? { kind: 'report', httpStatus: response.status, report } : { kind: 'not-report', httpStatus: response.status };
}
