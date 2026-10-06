import type { Code } from './codes.js';

/** Node and driver error codes that mean "nothing answered". */
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'EHOSTDOWN']);

/**
 * Maps an error to a fixed code by its `code` property only — a SQLSTATE
 * from the database driver or a Node system error code. It never reads an
 * error's message: driver messages routinely embed hosts, users and DSNs.
 */
export function mapError(check: string, error: unknown): Code {
  switch (check.split('.')[0]) {
    case 'database':
      return database(error);
    case 'storage':
      return 'storage_error';
    case 'queue':
      return 'queue_error';
    default:
      return 'check_error';
  }
}

function database(error: unknown): Code {
  for (const code of codes(error)) {
    if (UNREACHABLE.has(code)) return 'database_unreachable';
    if (/^[0-9A-Z]{5}$/.test(code)) {
      if (code === '3D000') return 'database_missing';
      if (code.startsWith('28')) return 'database_auth_failed';
      if (code.startsWith('08') || code === '57P03') return 'database_unreachable';
      if (code === '42P01' || code === '42S02') return 'database_migrations_pending';
      return 'database_error';
    }
  }
  return 'database_error';
}

/** `code` properties of the error, its causes and aggregated errors (bounded). */
function codes(error: unknown, depth = 0): string[] {
  if (depth > 4 || error === null || typeof error !== 'object') return [];
  const found: string[] = [];
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') found.push(code);
  const nested = (error as { errors?: unknown }).errors;
  if (Array.isArray(nested)) for (const inner of nested.slice(0, 8)) found.push(...codes(inner, depth + 1));
  found.push(...codes((error as { cause?: unknown }).cause, depth + 1));
  return found;
}
