import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCommit } from '../src/commit.js';
import { tempRoot } from './helpers.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
const none = () => null;

describe('resolveCommit', () => {
  it('prefers platform variables, in order', () => {
    const root = tempRoot();
    writeFileSync(join(root, 'REVISION'), B);
    expect(resolveCommit(root, (name) => ({ RENDER_GIT_COMMIT: A, DEPLOY_COMMIT: C })[name] ?? null)).toBe(A);
    expect(resolveCommit(root, (name) => ({ SOURCE_VERSION: C.toUpperCase() })[name] ?? null)).toBe(C);
  });

  it('falls back to the REVISION file, then .git read as files', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.git/refs/heads'), { recursive: true });
    writeFileSync(join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(root, '.git/packed-refs'), `# pack-refs with: peeled\n${D} refs/heads/main\n`);
    expect(resolveCommit(root, none)).toBe(D);

    writeFileSync(join(root, '.git/refs/heads/main'), `${C}\n`);
    expect(resolveCommit(root, none)).toBe(C);

    writeFileSync(join(root, 'REVISION'), `${B}\n`);
    expect(resolveCommit(root, none)).toBe(B);
  });

  it('reads a detached HEAD and ignores what is not a sha', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git/HEAD'), A);
    expect(resolveCommit(root, (name) => (name === 'DEPLOY_COMMIT' ? 'not-a-sha' : null))).toBe(A);
    expect(resolveCommit(tempRoot(), none)).toBeNull();
  });
});
