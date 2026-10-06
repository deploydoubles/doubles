import { describe, expect, it } from 'vitest';
import { mapError } from '../src/errors.js';

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
});
