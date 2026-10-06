import { describe, expect, it } from 'vitest';
import { dropTemporaryTable, nodeChecks } from '../src/checks.js';
import { makeConfig } from '../src/config.js';
import { isUnsupported } from '../src/errors.js';
import { fakeClient, SHA, tempRoot } from './helpers.js';

const leaky = (extra: object) => Object.assign(new Error('postgresql://leaky_user:leaky_password@db.internal/leaky_db: feature not supported'), extra);

function databaseCheck(client: ReturnType<typeof fakeClient>) {
  const config = makeConfig(tempRoot(), { checks: { database: { expected: 'postgres' } } }, () => null);
  return nodeChecks(config, SHA, client).database!;
}

describe('the database write test', () => {
  it('skips with database_write_unsupported when the server has no temporary tables', async () => {
    const result = await databaseCheck(fakeClient({ failCreate: leaky({ code: '0A000' }) }))();

    expect(result).toMatchObject({ status: 'skip', code: 'database_write_unsupported', expected: 'postgres', observed: 'postgres 17.6' });
    expect(JSON.stringify(result)).not.toContain('leaky');
  });

  it('still fails with database_write_failed when the create is refused for another reason', async () => {
    const result = await databaseCheck(fakeClient({ failCreate: leaky({ code: '42501' }) }))();

    expect(result).toMatchObject({ status: 'fail', code: 'database_write_failed' });
  });

  it('drops only the temporary probe table', async () => {
    const queries: string[] = [];
    const result = await databaseCheck(fakeClient({ queries }))();

    expect(result.status).toBe('pass');
    expect(queries).toContain('DROP TABLE pg_temp.deploy_report_probe');
    expect(queries).not.toContain('DROP TABLE deploy_report_probe');
    expect(dropTemporaryTable('mysql')).toBe('DROP TEMPORARY TABLE deploy_report_probe');
    expect(dropTemporaryTable('mariadb')).toBe('DROP TEMPORARY TABLE deploy_report_probe');
    expect(dropTemporaryTable('postgres')).toBe('DROP TABLE pg_temp.deploy_report_probe');
  });
});

describe('isUnsupported', () => {
  it('recognises a server that does not support a statement by its codes only', () => {
    expect(isUnsupported(leaky({ code: '0A000' }))).toBe(true);
    expect(isUnsupported(leaky({ code: 'ER_NOT_SUPPORTED_YET', errno: 1235, sqlState: '42000' }))).toBe(true);
    expect(isUnsupported(leaky({ errno: 1787 }))).toBe(true);
    expect(isUnsupported(new Error('wrapped', { cause: leaky({ code: '0A000' }) }))).toBe(true);
    expect(isUnsupported(leaky({ code: '42501' }))).toBe(false);
    expect(isUnsupported(leaky({ errno: 1044 }))).toBe(false);
    expect(isUnsupported(new Error('0A000 not supported'))).toBe(false);
  });
});
