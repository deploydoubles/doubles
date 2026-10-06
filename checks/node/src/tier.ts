import { createHash, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';

export const MIN_TOKEN_LENGTH = 32;
export const RUN_ID_HEADER = 'Deploy-Run-Id';

export type Tier = 'public' | 'full';

/**
 * Full tier when the request carries a valid bearer token (at least 32
 * characters, compared in constant time, Authorization header only), or when
 * the committed config sets `tier: full`. Anything else gets the public tier.
 */
export function decideTier(config: Config, authorization: string | null): Tier {
  if (config.tier === 'full') return 'full';

  const configured = config.token;
  if (configured === null || Buffer.byteLength(configured) < MIN_TOKEN_LENGTH) return 'public';

  const presented = bearer(authorization);
  if (presented === null) return 'public';

  return safeEqual(configured, presented) ? 'full' : 'public';
}

/** A warning to log when the configured token is unusable, or null. Never contains the token. */
export function configurationWarning(config: Config): string | null {
  const token = config.token;
  if (token !== null && token !== '' && Buffer.byteLength(token) < MIN_TOKEN_LENGTH) {
    return `DEPLOY_REPORT_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters and is ignored; the deploy report serves the public tier only.`;
  }
  return null;
}

/** Answers whether the Deploy-Run-Id header matches DEPLOY_RUN_ID: true, false or null. Never the value. */
export function runIdMatch(configured: string | null, presented: string | null): boolean | null {
  if (!configured || !presented) return null;
  return safeEqual(configured, presented.trim());
}

/**
 * Strips a full report (from the reader) down to the tier.
 */
export function applyTier(full: FullReport, tier: Tier, match: boolean | null): object {
  const deploy = full.deploy;
  if (tier === 'full') {
    return { status: full.status, deploy: { ...deploy, tier: 'full', release: { ...deploy.release, run_id_match: match } } };
  }
  const checks: Record<string, { status: unknown }> = {};
  for (const [name, check] of Object.entries(deploy.checks)) {
    checks[name] = { status: (check as { status: unknown }).status };
  }
  return { status: full.status, deploy: { spec_version: deploy.spec_version, tier: 'public', settled: deploy.settled, checks } };
}

export interface FullReport {
  status: 'pass' | 'warn' | 'fail';
  deploy: {
    spec_version: '0.1';
    tier: 'full';
    settled: boolean;
    checks: Record<string, Record<string, unknown>>;
    app: Record<string, string>;
    release: { commit: string | null; booted_at: string | null; run_id_match: boolean | null };
  };
}

/** Constant-time comparison of two strings of any length (compares SHA-256 digests). */
function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

function bearer(header: string | null): string | null {
  const match = header === null ? null : /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? (match[1] ?? null) : null;
}
