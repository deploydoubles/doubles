import type { CheckOutcome, ExitCode, VerifyResult } from './types.js';

const KNOWN: ReadonlySet<string> = new Set(['pass', 'warn', 'fail', 'pending', 'skip']);

function outside(result: VerifyResult, name: string): CheckOutcome | undefined {
  return result.outside.find((c) => c.name === name);
}

/**
 * The only place an exit code is chosen.
 *
 *   3 — unreachable (no report, TLS failed), wrong release, or run ID mismatch
 *   1 — a check failed (inside, or an outside check such as https_redirect or downtime), or the
 *       report says it failed (top-level `status: fail` or HTTP 503) or disagrees with itself
 *   2 — still not settled, or no result produced since the release was first seen, when the
 *       timeout passed; or --during-deploy saw no switch
 *   0 — every check passed on the expected release, on evidence from this deployment
 *
 * When several apply, 3 wins over 1, and 1 over 2. Anything ambiguous is non-zero.
 */
export function decideExitCode(result: VerifyResult): ExitCode {
  if (!result.reachable) return 3;
  if (outside(result, 'tls')?.status === 'fail') return 3;
  if (outside(result, 'release')?.status !== 'pass') return 3;
  if (result.runIdRequested && outside(result, 'run_id')?.status !== 'pass') return 3;

  const all = [...result.inside, ...result.outside];
  if (all.some((c) => c.status === 'fail' || !KNOWN.has(c.status))) return 1;
  // The report's own verdict is never overruled into a pass.
  if (result.reportStatus !== 'pass' && result.reportStatus !== 'warn') return 1;
  if (result.httpStatus !== 200) return 1;
  if (!result.settled || !result.fresh || all.some((c) => c.status === 'pending')) return 2;

  return 0;
}
