import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createDeployReportHandler, runDeployReport } from '../src/next.js';
import { readReport } from '../src/reader.js';
import { runChecks } from '../src/runner.js';
import { nodeChecks } from '../src/checks.js';
import { FileStore } from '../src/store.js';
import { SHA, TOKEN, fakeClient, tempRoot } from './helpers.js';

// The schema lives in the monorepo's spec/; outside it (the read-only split), schema assertions pass trivially.
const schemaUrl = new URL('../../../spec/schema/report-v0.1.json', import.meta.url);
const validate = existsSync(schemaUrl)
  ? new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(schemaUrl, 'utf8')))
  : () => true;

let root: string;
const saved = { ...process.env };

function configure(file: object): void {
  writeFileSync(join(root, 'deploy-report.config.json'), JSON.stringify(file));
}

async function get(headers: Record<string, string> = {}): Promise<{ status: number; text: string; json: any; headers: Headers }> {
  const response = await createDeployReportHandler({ root })(new Request('http://localhost/.well-known/deploy-report', { headers }));
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text), headers: response.headers };
}

beforeEach(() => {
  root = tempRoot();
  writeFileSync(join(root, 'REVISION'), SHA);
  for (const name of ['DEPLOY_COMMIT', 'SOURCE_VERSION', 'RAILWAY_GIT_COMMIT_SHA', 'RENDER_GIT_COMMIT', 'VERCEL_GIT_COMMIT_SHA', 'DEPLOY_REPORT_TOKEN', 'DEPLOY_RUN_ID']) delete process.env[name];
});

afterEach(() => {
  process.env = { ...saved };
});

describe('the report', () => {
  it('runs on the schedule and serves a full-tier report that matches the schema and the PHP shape', async () => {
    process.env.APP_SECRET_FOR_TEST = 'x';
    configure({ tier: 'full', name: 'nextjs-postgres', double: 'nextjs-postgres', checks: { database: { expected: 'postgres' }, scheduler: {}, 'scheduler.release': {}, storage: {}, env: { required: ['APP_SECRET_FOR_TEST'] } } });

    await runDeployReport({ root, database: fakeClient() });
    const { status, json, headers } = await get();

    expect(status).toBe(200);
    expect(headers.get('content-type')).toBe('application/health+json');
    expect(headers.get('cache-control')).toBe('no-store');
    expect(validate(json)).toBe(true);
    expect(Object.keys(json)).toEqual(['status', 'deploy']);
    expect(Object.keys(json.deploy)).toEqual(['spec_version', 'tier', 'settled', 'checks', 'app', 'release']);
    expect(Object.keys(json.deploy.release)).toEqual(['commit', 'booted_at', 'run_id_match']);
    expect(json.status).toBe('pass');
    expect(json.deploy.settled).toBe(true);
    expect(json.deploy.release.commit).toBe(SHA);
    expect(json.deploy.checks.database).toMatchObject({ status: 'pass', expected: 'postgres', observed: 'postgres 17.6' });
    expect(Object.keys(json.deploy.checks.database)).toEqual(['status', 'expected', 'observed', 'detail', 'checked_at']);
    expect(json.deploy.app).toMatchObject({ name: 'nextjs-postgres', double: 'nextjs-postgres' });
    expect(json.deploy.app.runtime).toMatch(/^node \d+\.\d+$/);
  });

  it('serves a public tier that matches the schema without a token, and the full tier with one', async () => {
    process.env.DEPLOY_REPORT_TOKEN = TOKEN;
    process.env.DEPLOY_RUN_ID = 'run-42';
    configure({ checks: { scheduler: {}, storage: {} } });
    await runDeployReport({ root });

    const pub = await get();
    const full = await get({ authorization: `Bearer ${TOKEN}`, 'deploy-run-id': 'run-42' });
    const wrongRun = await get({ authorization: `Bearer ${TOKEN}`, 'deploy-run-id': 'run-43' });

    expect(validate(pub.json)).toBe(true);
    expect(pub.json.deploy.tier).toBe('public');
    expect(pub.json.deploy).not.toHaveProperty('release');
    expect(full.json.deploy.tier).toBe('full');
    expect(full.json.deploy.release.run_id_match).toBe(true);
    expect(wrongRun.json.deploy.release.run_id_match).toBe(false);
    expect(full.text).not.toContain('run-42');
    expect(full.text).not.toContain(TOKEN);
  });

  it('never touches the database when the report is read', async () => {
    configure({ tier: 'full', checks: { database: {}, scheduler: {} } });
    const calls = { n: 0 };
    await runDeployReport({ root, database: fakeClient({ calls }) });
    expect(calls.n).toBe(1);

    await get();
    await get();

    expect(calls.n).toBe(1);
  });

  it('reports an unreachable database as a fixed code with no host, user or password', async () => {
    configure({ tier: 'full', checks: { database: { expected: 'postgres' }, scheduler: {} } });
    const error = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432 postgresql://leaky_user:leaky_password@db.internal/leaky_db'), {
      code: 'ECONNREFUSED',
      address: '10.1.2.3',
      port: 5432,
    });
    await runDeployReport({ root, database: fakeClient({ failConnect: error }) });

    const { status, text, json } = await get();

    expect(status).toBe(503);
    expect(validate(json)).toBe(true);
    expect(json.deploy.checks.database).toMatchObject({ status: 'fail', code: 'database_unreachable' });
    for (const secret of ['leaky_user', 'leaky_password', 'leaky_db', 'db.internal', '10.1.2.3', 'ECONNREFUSED', 'postgresql://', root]) {
      expect(text).not.toContain(secret);
    }
  });

  it('reports only scheduler: fail when the results are stale, and before a first run that never comes', () => {
    configure({ tier: 'full', checks: { database: {}, scheduler: {}, storage: {} } });
    const config = loadConfig(root);
    const store = new FileStore(config.storePath);

    const first = readReport(store, config, SHA, 1_000);
    expect(first.deploy.settled).toBe(false);
    expect(first.status).toBe('warn');

    const late = readReport(store, config, SHA, 1_121);
    expect(Object.keys(late.deploy.checks)).toEqual(['scheduler']);
    expect(late.deploy.checks.scheduler).toMatchObject({ status: 'fail', code: 'scheduler_not_running' });
  });

  it('turns stale results into scheduler: fail', async () => {
    configure({ tier: 'full', checks: { storage: {}, scheduler: {} } });
    const config = loadConfig(root);
    const store = new FileStore(config.storePath);
    await runChecks(store, config, SHA, nodeChecks(config, SHA), { now: 5_000 });

    expect(readReport(store, config, SHA, 5_060).status).toBe('pass');
    const stale = readReport(store, config, SHA, 5_181);
    expect(Object.keys(stale.deploy.checks)).toEqual(['scheduler']);
    expect(stale.deploy.checks.scheduler).toMatchObject({ status: 'fail', code: 'scheduler_results_stale' });
  });

  it('fails the database check on the wrong engine', async () => {
    configure({ tier: 'full', checks: { database: { expected: 'postgres' }, scheduler: {} } });
    await runDeployReport({ root, database: fakeClient({ version: '8.4.2' }) });

    const { json } = await get();
    expect(json.deploy.checks.database).toMatchObject({ status: 'fail', code: 'database_engine_mismatch', observed: 'mysql 8.4' });
  });
});
