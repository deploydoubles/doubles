import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { env as readEnv } from './environment.js';

export const CONFIG_FILE = 'deploy-report.config.json';

export const KNOWN_CHECKS = ['database', 'cache', 'queue', 'queue.release', 'scheduler', 'scheduler.release', 'storage', 'assets', 'env'] as const;

export type CheckDeclaration = { expected?: unknown; required?: unknown };

/**
 * The report configuration. `tier` comes only from the committed
 * deploy-report.config.json — a JSON file cannot read the environment, so no
 * platform variable can switch it. `token` and `runId` are the only values
 * that come from the environment.
 */
export interface Config {
  root: string;
  storePath: string;
  markerPath: string;
  /** Declared checks, in report order. */
  checks: Record<string, CheckDeclaration>;
  tier: 'public' | 'full';
  token: string | null;
  runId: string | null;
  appName: string | null;
  double: string | null;
}

export function loadConfig(root: string = process.cwd(), env: (name: string) => string | null = readEnv): Config {
  let file: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, CONFIG_FILE), 'utf8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) file = parsed as Record<string, unknown>;
  } catch {
    // No (or unreadable) config: the public tier and inferred checks.
  }
  return makeConfig(root, file, env);
}

export function makeConfig(root: string, file: Record<string, unknown>, env: (name: string) => string | null = readEnv): Config {
  const declared = file.checks !== null && typeof file.checks === 'object' && !Array.isArray(file.checks)
    ? (file.checks as Record<string, unknown>)
    : { scheduler: {}, 'scheduler.release': {}, storage: {} };

  const checks: Record<string, CheckDeclaration> = {};
  for (const name of KNOWN_CHECKS) {
    if (Object.hasOwn(declared, name)) {
      const value = declared[name];
      checks[name] = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as CheckDeclaration) : {};
    }
  }

  return {
    root,
    storePath: path(root, file.store_path, 'storage/deploy-report'),
    markerPath: path(root, file.storage_marker_path, 'storage/app/deploy-report'),
    checks,
    tier: file.tier === 'full' ? 'full' : 'public',
    token: env('DEPLOY_REPORT_TOKEN'),
    runId: env('DEPLOY_RUN_ID'),
    appName: typeof file.name === 'string' && file.name !== '' ? file.name : null,
    double: typeof file.double === 'string' && file.double !== '' ? file.double : null,
  };
}

export function declares(config: Config, check: string): boolean {
  return Object.hasOwn(config.checks, check);
}

export function expected(config: Config, check: string): string | null {
  const value = config.checks[check]?.expected;
  return typeof value === 'string' && /^[a-z0-9-]+$/.test(value) ? value : null;
}

export function requiredEnv(config: Config): string[] {
  const names = config.checks.env?.required;
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string' && /^[A-Z][A-Z0-9_]*$/.test(name)) : [];
}

function path(root: string, value: unknown, fallback: string): string {
  const relative = typeof value === 'string' && value !== '' ? value : fallback;
  return isAbsolute(relative) ? relative : join(root, relative);
}
