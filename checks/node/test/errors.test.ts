import { describe, expect, it } from 'vitest';
import { DatabaseConnectError, DeployReportTimeoutError, mapError } from '../src/errors.js';

const leaky = (code: string | undefined, extra: object = {}) =>
  Object.assign(new Error('connect to postgresql://leaky_user:leaky_password@db.internal:5432/leaky_db failed'), code ? { code } : {}, extra);

describe('mapError', () => {
  it('maps by code only', () => {
    expect(mapError('database', leaky('ECONNREFUSED'))).toBe('database_unreachable');
    expect(mapError('database', leaky('ENOTFOUND'))).toBe('database_unreachable');
    expect(mapError('database', leaky('28P01'))).toBe('database_auth_failed');
    expect(mapError('database', leaky('3D000'))).toBe('database_missing');
    expect(mapError('database', leaky('42P01'))).toBe('database_migrations_pending');
    expect(mapError('database', leaky('XX000'))).toBe('database_error');
    expect(mapError('database', leaky(undefined))).toBe('database_error');
    expect(mapError('storage', leaky('EACCES'))).toBe('storage_error');
    expect(mapError('env', leaky('X'))).toBe('check_error');
  });

  it('finds the code in aggregated errors and causes', () => {
    const aggregate = Object.assign(new AggregateError([leaky('ECONNREFUSED'), leaky('ECONNREFUSED')], 'all failed'), {});
    expect(mapError('database', aggregate)).toBe('database_unreachable');
    expect(mapError('database', new Error('wrapped', { cause: leaky('28000') }))).toBe('database_auth_failed');
  });

  it('never reads the message, even when it looks like a code', () => {
    expect(mapError('database', new Error('ECONNREFUSED 28P01'))).toBe('database_error');
  });

  it('maps a connect failure without any code to database_unreachable by its class, and nothing else', () => {
    // node-postgres's connectionTimeoutMillis: a plain Error, no code, no cause.
    expect(mapError('database', new DatabaseConnectError(new Error('timeout expired')))).toBe('database_unreachable');
    expect(mapError('database', new Error('wrapped', { cause: new DatabaseConnectError(new Error('x')) }))).toBe('database_unreachable');
    // The same error outside connect is not decided by its text.
    expect(mapError('database', new Error('timeout expired'))).toBe('database_error');
    // A code still wins over the connect class.
    expect(mapError('database', new DatabaseConnectError(leaky('28P01')))).toBe('database_auth_failed');
    expect(mapError('database', new DatabaseConnectError(leaky('XX000')))).toBe('database_error');
  });

  it('maps the check bound passing to database_unreachable', () => {
    expect(mapError('database', new DeployReportTimeoutError())).toBe('database_unreachable');
  });

  it('maps 57P03 (starting up) to database_unreachable, as checks-php does', () => {
    expect(mapError('database', leaky('57P03'))).toBe('database_unreachable');
  });

  it("maps mysql2's errors as checks-php maps the same server errors", () => {
    const mysql2 = (code: string, errno: number, sqlState?: string) => leaky(code, { errno, ...(sqlState ? { sqlState } : {}) });
    expect(mapError('database', mysql2('ER_ACCESS_DENIED_ERROR', 1045, '28000'))).toBe('database_auth_failed');
    expect(mapError('database', mysql2('ER_DBACCESS_DENIED_ERROR', 1044, '42000'))).toBe('database_auth_failed');
    expect(mapError('database', mysql2('ER_ACCESS_DENIED_NO_PASSWORD_ERROR', 1698, '28000'))).toBe('database_auth_failed');
    expect(mapError('database', mysql2('ER_BAD_DB_ERROR', 1049, '42000'))).toBe('database_missing');
    expect(mapError('database', mysql2('ER_NO_SUCH_TABLE', 1146, '42S02'))).toBe('database_migrations_pending');
    expect(mapError('database', mysql2('ECONNREFUSED', -111))).toBe('database_unreachable');
    expect(mapError('database', mysql2('PROTOCOL_CONNECTION_LOST', 2013))).toBe('database_unreachable');
    // By string code alone, and by errno alone.
    expect(mapError('database', leaky('ER_ACCESS_DENIED_ERROR'))).toBe('database_auth_failed');
    expect(mapError('database', leaky('ER_BAD_DB_ERROR'))).toBe('database_missing');
    expect(mapError('database', leaky(undefined, { errno: 1045 }))).toBe('database_auth_failed');
    expect(mapError('database', leaky(undefined, { errno: 2002 }))).toBe('database_unreachable');
    expect(mapError('database', leaky('ER_SOMETHING_ELSE', { errno: 9999 }))).toBe('database_error');
  });
});

