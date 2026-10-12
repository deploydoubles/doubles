import { resolveCommit } from '@deploydoubles/checks';

/**
 * Deliberate failures (spec/failure-modes.md): DOUBLE_FAIL=<mode>@<commit>
 * fires <mode> only on the release built from <commit>. Anything else — no
 * value, no "@", another commit, a commit that cannot be resolved — leaves
 * the double behaving normally. Read at run time, never at build time.
 */
export function doubleFailure(mode: string): boolean {
  const value = process.env.DOUBLE_FAIL;
  if (typeof value !== 'string' || value.split('@').length !== 2) return false;

  const [named, commit] = value.split('@');
  if (named !== mode || !commit) return false;

  const own = resolveCommit(process.cwd());
  return own !== null && commit === own;
}
