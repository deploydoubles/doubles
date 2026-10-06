import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { env as readEnv } from './environment.js';

/** Platform variables, in the order checks-php reads them. */
export const COMMIT_ENV_VARS = ['RAILWAY_GIT_COMMIT_SHA', 'RENDER_GIT_COMMIT', 'VERCEL_GIT_COMMIT_SHA', 'SOURCE_VERSION', 'DEPLOY_COMMIT'] as const;

const SHA = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Resolves the commit the running code was built from, without configuration
 * and without a git binary: 1. platform variables, 2. a REVISION file,
 * 3. the .git directory read as files. Same order as checks-php.
 */
export function resolveCommit(basePath: string, env: (name: string) => string | null = readEnv): string | null {
  for (const name of COMMIT_ENV_VARS) {
    const sha = normalise(env(name));
    if (sha) return sha;
  }
  return normalise(readText(join(basePath, 'REVISION'))) ?? fromGitDirectory(basePath);
}

function fromGitDirectory(basePath: string): string | null {
  let gitDir = join(basePath, '.git');
  if (isFile(gitDir)) {
    // A .git file (worktree or submodule) points at the real directory.
    const pointer = readText(gitDir);
    if (!pointer || !pointer.startsWith('gitdir:')) return null;
    const target = pointer.slice('gitdir:'.length).trim();
    gitDir = isAbsolute(target) ? target : join(basePath, target);
  }

  const head = readText(join(gitDir, 'HEAD'));
  if (head === null) return null;
  if (!head.startsWith('ref:')) return normalise(head);

  const ref = head.slice('ref:'.length).trim();
  if (ref === '' || ref.includes('..') || !ref.startsWith('refs/')) return null;

  const loose = normalise(readText(join(gitDir, ref)));
  if (loose) return loose;

  const packed = readText(join(gitDir, 'packed-refs'));
  if (packed === null) return null;
  for (const line of packed.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#') || line.startsWith('^')) continue;
    const [sha, name] = line.split(' ', 2);
    if (name === ref) return normalise(sha ?? null);
  }
  return null;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readText(path: string): string | null {
  try {
    if (!statSync(path).isFile()) return null;
    return readFileSync(path, 'utf8').slice(0, 65536 * 16).trim();
  } catch {
    return null;
  }
}

function normalise(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const sha = value.trim().toLowerCase();
  return SHA.test(sha) ? sha : null;
}
