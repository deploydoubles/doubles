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

describe.skipIf(!existsSync(CLI))('cli (built)', () => {
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

  it('list is an empty stub for now', async () => {
    const { code, stdout } = await cli(['list', '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ doubles: [] });
  });
});
