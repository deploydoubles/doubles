import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHA, report, sendJson, serve } from './helpers.js';

const run = promisify(execFile);
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;

let s: Awaited<ReturnType<typeof serve>>;
beforeAll(async () => {
  s = await serve((req, res) => sendJson(res, report({ runIdMatch: req.headers['deploy-run-id'] === 'secret-run' })));
});
afterAll(async () => s.close());

async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

// Locally the CLI tests skip until `npm run build`; in CI a missing build is a failure, never a skip.
const built = existsSync(CLI);

it('has a built CLI to test when running in CI', () => {
  expect(built || !process.env.CI, 'dist/cli.js is missing: run npm run build before npm test').toBe(true);
});

describe.skipIf(!built && !process.env.CI)('cli (built)', () => {
  it('prints one JSON object and nothing on stderr in --json mode', async () => {
    const { code, stdout, stderr } = await cli(['verify', s.url, '--commit', SHA, '--timeout', '5', '--json', '--token', 'x'.repeat(40), '--run-id', 'secret-run']);
    const out = JSON.parse(stdout);

    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(out).toMatchObject({ ok: true, url: s.url, commit: SHA });
    expect(stdout).not.toContain('x'.repeat(40));
    expect(stdout).not.toContain('secret-run');
    expect(stdout).not.toContain('Vera');
  });

  it("prints Vera's verdict in human mode", async () => {
    const { code, stdout } = await cli(['verify', s.url, '--commit', SHA, '--timeout', '5']);

    expect(code).toBe(0);
    expect(stdout).toContain('Vera: Deployed, and working.');
  });

  it('refuses to send a token over plain http to a non-loopback host (exit 64)', async () => {
    const { code, stdout, stderr } = await cli(['verify', 'http://example.com', '--commit', SHA, '--token', 'x'.repeat(40)]);

    expect(code).toBe(64);
    expect(stdout).toBe('');
    expect(stderr).toContain('--token');
    expect(stderr).not.toContain('x'.repeat(40));
  });

  it('allows a token over http to a loopback address', async () => {
    const { code } = await cli(['verify', s.url, '--commit', SHA, '--timeout', '5', '--token', 'x'.repeat(40), '--json']);
    expect(code).toBe(0);
  });

  it('list is an empty stub for now', async () => {
    const { code, stdout } = await cli(['list', '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ doubles: [] });
  });
});
