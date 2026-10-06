import type { ExitCode, VerifyResult } from './types.js';

export interface JsonOutput {
  ok: boolean;
  exit_code: ExitCode;
  url: string;
  commit: string;
  served_commit: string | null;
  checks: { name: string; status: string; hint?: string }[];
  downtime?: { failed: number; longest_gap_ms: number };
}

export function toJson(result: VerifyResult, code: ExitCode): JsonOutput {
  const out: JsonOutput = {
    ok: code === 0,
    exit_code: code,
    url: result.url,
    commit: result.commit,
    served_commit: result.servedCommit,
    checks: [...result.outside, ...result.inside].map((c) => (c.hint ? { name: c.name, status: c.status, hint: c.hint } : { name: c.name, status: c.status })),
  };
  if (result.downtime) out.downtime = result.downtime;
  return out;
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 7) : 'unknown';
}

/** Vera's one-line verdict. Human mode only; never part of --json output. */
export function veraLine(result: VerifyResult, code: ExitCode): string {
  const failing = [...result.outside, ...result.inside].filter((c) => c.status === 'fail').map((c) => c.name);
  const pending = result.inside.filter((c) => c.status === 'pending').map((c) => c.name);
  switch (code) {
    case 0:
      return `Vera: Deployed, and working. Every check passed on ${short(result.commit)}.`;
    case 1:
      return `Vera: Deployed is not the same as working. Failed: ${failing.join(', ')}.`;
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
  const lines: string[] = [`Verifying ${result.url} for ${short(result.commit)}`, ''];
  for (const check of [...result.outside, ...result.inside]) {
    lines.push(`  ${mark[check.status] ?? '????'}  ${check.name}`);
    if (check.hint && check.status !== 'pass') lines.push(`        ${check.hint}`);
  }
  if (result.downtime) {
    lines.push('', `  downtime: ${result.downtime.failed} failed request(s), longest gap ${result.downtime.longest_gap_ms} ms`);
  }
  lines.push('', veraLine(result, code));
  return lines.join('\n');
}
