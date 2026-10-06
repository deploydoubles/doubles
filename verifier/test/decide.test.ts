import { describe, expect, it } from 'vitest';
import { decideExitCode } from '../src/decide.js';
import type { VerifyResult } from '../src/types.js';

function base(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    url: 'http://localhost:8080',
    commit: 'a'.repeat(40),
    servedCommit: 'a'.repeat(40),
    reachable: true,
    outside: [
      { name: 'reachability', status: 'pass' },
      { name: 'tls', status: 'skip' },
      { name: 'https_redirect', status: 'skip' },
      { name: 'release', status: 'pass' },
    ],
    inside: [{ name: 'database', status: 'pass' }],
    settled: true,
    runIdRequested: false,
    ...overrides,
  };
}

describe('decideExitCode', () => {
  it('returns 0 when every check passes on the expected release', () => {
    expect(decideExitCode(base())).toBe(0);
  });

  it('treats warn and skip as passing', () => {
    expect(decideExitCode(base({ inside: [{ name: 'cache', status: 'warn' }, { name: 'assets', status: 'skip' }] }))).toBe(0);
  });

  it('returns 1 when an inside check failed', () => {
    expect(decideExitCode(base({ inside: [{ name: 'queue', status: 'fail' }] }))).toBe(1);
  });

  it('returns 1 when an outside check failed', () => {
    const r = base();
    r.outside.push({ name: 'downtime', status: 'fail' });
    expect(decideExitCode(r)).toBe(1);
  });

  it('returns 2 when still pending', () => {
    expect(decideExitCode(base({ settled: false, inside: [{ name: 'queue', status: 'pending' }] }))).toBe(2);
  });

  it('prefers 1 over 2 when a check failed and another is still pending', () => {
    expect(decideExitCode(base({ settled: false, inside: [{ name: 'queue', status: 'pending' }, { name: 'database', status: 'fail' }] }))).toBe(1);
  });

  it('returns 3 when unreachable', () => {
    expect(decideExitCode(base({ reachable: false }))).toBe(3);
  });

  it('returns 3 for the wrong release, even when everything else fails or is pending', () => {
    const r = base({ settled: false, inside: [{ name: 'database', status: 'fail' }] });
    r.outside = r.outside.map((c) => (c.name === 'release' ? { ...c, status: 'fail' } : c));
    expect(decideExitCode(r)).toBe(3);
  });

  it('returns 3 for a TLS failure', () => {
    const r = base();
    r.outside = r.outside.map((c) => (c.name === 'tls' ? { ...c, status: 'fail' } : c));
    expect(decideExitCode(r)).toBe(3);
  });

  it('returns 3 for a run ID mismatch only when a run ID was requested', () => {
    const r = base({ runIdRequested: true });
    r.outside.push({ name: 'run_id', status: 'fail' });
    expect(decideExitCode(r)).toBe(3);
    expect(decideExitCode(base({ runIdRequested: true }))).toBe(3); // requested but never compared
  });

  it('treats an unknown status as a failure', () => {
    expect(decideExitCode(base({ inside: [{ name: 'x', status: 'unknown' as never }] }))).toBe(1);
  });
});
