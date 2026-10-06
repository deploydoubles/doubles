import { hint, isCode, type Code } from './codes.js';

export type Status = 'pass' | 'warn' | 'fail' | 'pending' | 'skip';

const STATUSES: readonly Status[] = ['pass', 'warn', 'fail', 'pending', 'skip'];
const ENGINE = /^[a-z0-9-]+( [0-9]+\.[0-9]+)?$/;

/**
 * One check's result. Every field is validated on the way in and out, so a
 * result read back from the store can never carry free text into the report.
 */
export interface CheckResult {
  status: Status;
  expected?: string | null;
  observed?: string | null;
  code?: Code | null;
  detail?: string | null;
  retryAfter?: number | null;
  checkedAt?: number | null;
}

export function pass(detail?: string, expected?: string | null, observed?: string | null): CheckResult {
  return { status: 'pass', detail, expected, observed };
}

export function fail(code: string, detail?: string, expected?: string | null, observed?: string | null): CheckResult {
  return { status: 'fail', code: isCode(code) ? code : 'check_error', detail, expected, observed };
}

export function pending(retryAfter: number, detail?: string): CheckResult {
  return { status: 'pending', retryAfter: Math.max(1, Math.min(600, Math.round(retryAfter))), detail };
}

/** The full-tier representation: the same keys, in the same order, as checks-php. */
export function toReport(result: CheckResult): Record<string, unknown> {
  const out: Record<string, unknown> = { status: result.status };
  if (typeof result.expected === 'string' && ENGINE.test(result.expected)) out.expected = result.expected;
  if (typeof result.observed === 'string' && ENGINE.test(result.observed)) out.observed = result.observed;
  if (result.code && isCode(result.code)) out.code = result.code;
  if (typeof result.detail === 'string' && result.detail !== '') out.detail = [...result.detail].slice(0, 200).join('');
  if (result.code && isCode(result.code)) out.hint = hint(result.code);
  if (result.status === 'pending' && typeof result.retryAfter === 'number') out.retry_after = result.retryAfter;
  if (typeof result.checkedAt === 'number') out.checked_at = timestamp(result.checkedAt);
  return out;
}

export function toStore(result: CheckResult): Record<string, unknown> {
  return {
    status: result.status,
    expected: result.expected ?? null,
    observed: result.observed ?? null,
    code: result.code ?? null,
    detail: result.detail ?? null,
    retry_after: result.retryAfter ?? null,
    checked_at: result.checkedAt ?? null,
  };
}

export function fromStore(data: unknown): CheckResult {
  const d = (data ?? {}) as Record<string, unknown>;
  const status = STATUSES.includes(d.status as Status) ? (d.status as Status) : 'fail';
  let code: Code | null = isCode(d.code) ? d.code : null;
  if (status === 'fail' && code === null) code = 'check_error';
  return {
    status,
    expected: typeof d.expected === 'string' ? d.expected : null,
    observed: typeof d.observed === 'string' ? d.observed : null,
    code,
    detail: typeof d.detail === 'string' ? d.detail : null,
    retryAfter: Number.isInteger(d.retry_after) ? (d.retry_after as number) : null,
    checkedAt: Number.isInteger(d.checked_at) ? (d.checked_at as number) : null,
  };
}

/** Seconds since the epoch → `YYYY-MM-DDTHH:MM:SSZ`, as checks-php writes it. */
export function timestamp(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
