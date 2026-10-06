import { printable } from './hints.js';
import type { CheckOutcome, ExitCode, VerifyResult } from './types.js';

export interface JsonOutput {
  ok: boolean;
  exit_code: ExitCode;
  url: string;
  commit: string;
  served_commit: string | null;
  checks: { name: string; status: string; hint?: string }[];
  downtime?: { requests: number; failed: number; longest_gap_ms: number; old_release_seen: boolean };
}

/** Every string printed passes through here: nothing unprintable reaches a terminal or a log. */
function clean(check: CheckOutcome): { name: string; status: string; hint?: string } {
  const out: { name: string; status: string; hint?: string } = { name: printable(check.name), status: printable(check.status) };
  if (check.hint) out.hint = printable(check.hint);
  return out;
}

export function toJson(result: VerifyResult, code: ExitCode): JsonOutput {
  const out: JsonOutput = {
    ok: code === 0,
    exit_code: code,
    url: printable(result.url),
    commit: printable(result.commit),
    served_commit: result.servedCommit === null ? null : printable(result.servedCommit),
    checks: [...result.outside, ...result.inside].map(clean),
  };
  if (result.downtime) out.downtime = { ...result.downtime };
  return out;
}

function short(sha: string | null): string {
  return sha ? printable(sha).slice(0, 7) : 'unknown';
}

/** Vera's one-line verdict. Human mode only; never part of --json output. */
export function veraLine(result: VerifyResult, code: ExitCode): string {
  const all = [...result.outside, ...result.inside].map(clean);
  const failing = all.filter((c) => c.status === 'fail').map((c) => c.name);
  const pending = all.filter((c) => c.status === 'pending').map((c) => c.name);
  switch (code) {
    case 0:
      return `Vera: Deployed, and working. Every check passed on ${short(result.commit)}.`;
    case 1:
      return failing.length > 0
        ? `Vera: Deployed is not the same as working. Failed: ${failing.join(', ')}.`
        : 'Vera: Deployed is not the same as working. The report itself says it failed.';
    case 2:
      return `Vera: Still settling when the clock ran out. Pending: ${pending.join(', ') || 'the report'}.`;
    case 3:
      if (!result.reachable) return 'Vera: Nobody answered. No deploy report at that address.';
      if (result.outside.find((c) => c.name === 'release')?.status !== 'pass') {
        return `Vera: Wrong release on stage. Expected ${short(result.commit)}, got ${short(result.servedCommit)}.`;
      }
      return 'Vera: Right code, wrong environment. The run ID never arrived.';
  }
}

export function toHuman(result: VerifyResult, code: ExitCode): string {
  const mark = { pass: 'ok  ', warn: 'warn', fail: 'FAIL', pending: 'wait', skip: 'skip' } as Record<string, string>;
  const lines: string[] = [`Verifying ${printable(result.url)} for ${short(result.commit)}`, ''];
  for (const check of [...result.outside, ...result.inside].map(clean)) {
    lines.push(`  ${mark[check.status] ?? '????'}  ${check.name}`);
    if (check.hint && check.status !== 'pass') lines.push(`        ${check.hint}`);
  }
  if (result.downtime) {
    const d = result.downtime;
    lines.push(
      '',
      `  downtime: ${d.requests} request(s), ${d.failed} failed, longest gap ${d.longest_gap_ms} ms${d.old_release_seen ? '' : ', previous release never seen'}`,
    );
  }
  lines.push('', veraLine(result, code));
  return lines.join('\n');
}
