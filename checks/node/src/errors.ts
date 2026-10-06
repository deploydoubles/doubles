import type { Code } from './codes.js';

/** Node system error codes and mysql2 client codes that mean "nothing answered". */
const UNREACHABLE = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'EHOSTDOWN',
  'PROTOCOL_CONNECTION_LOST',
]);

/** mysql2's string codes for the server errors checks-php maps by number (ErrorMapper). */
const MYSQL_CODES: Readonly<Record<string, Code>> = {
  ER_DBACCESS_DENIED_ERROR: 'database_auth_failed',
  ER_ACCESS_DENIED_ERROR: 'database_auth_failed',
  ER_ACCESS_DENIED_NO_PASSWORD_ERROR: 'database_auth_failed',
  ER_BAD_DB_ERROR: 'database_missing',
  ER_NO_SUCH_TABLE: 'database_migrations_pending',
};

/** MySQL/MariaDB error numbers, exactly as checks-php's ErrorMapper lists them. */
const MYSQL_ERRNOS: ReadonlyArray<[readonly number[], Code]> = [
  [[2002, 2003, 2005, 2006, 2013], 'database_unreachable'],
  [[1044, 1045, 1698], 'database_auth_failed'],
  [[1049], 'database_missing'],
  [[1146], 'database_migrations_pending'],
];

/** ER_NOT_SUPPORTED_YET (also Vitess), ER_GTID_UNSAFE_CREATE_DROP_TEMPORARY_TABLE_IN_TRANSACTION. */
const MYSQL_UNSUPPORTED = new Set([1235, 1787]);

/**
 * The database work of one check ran past its bound. Mapped by its code, like
 * a driver's own connect timeout: the database did not answer.
 */
export class DeployReportTimeoutError extends Error {
  readonly code = 'ETIMEDOUT';

  constructor() {
    super('the database did not answer in time');
    this.name = 'DeployReportTimeoutError';
  }
}

/**
 * The client's connect() failed. Some drivers end a connect attempt without a
 * code — node-postgres's connectionTimeoutMillis, a connection closed during
 * the handshake — and that failure is decided by this class, never by text.
 */
export class DatabaseConnectError extends Error {
  constructor(cause: unknown) {
    super('the database connection failed', { cause });
    this.name = 'DatabaseConnectError';
  }
}

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
  // Driver error numbers first, as in checks-php.
  for (const errno of errnos(error)) {
    for (const [numbers, code] of MYSQL_ERRNOS) if (numbers.includes(errno)) return code;
  }
  for (const code of codes(error)) {
    if (UNREACHABLE.has(code)) return 'database_unreachable';
    if (Object.hasOwn(MYSQL_CODES, code)) return MYSQL_CODES[code]!;
    if (/^[0-9A-Z]{5}$/.test(code)) {
      if (code === '3D000') return 'database_missing';
      if (code.startsWith('28')) return 'database_auth_failed';
      // 57P03: the server is starting up or shutting down, so it did not accept the connection.
      if (code.startsWith('08') || code === '57P03') return 'database_unreachable';
      if (code === '42P01' || code === '42S02') return 'database_migrations_pending';
      return 'database_error';
    }
  }
  // A connect that failed with no code at all: nothing answered.
  return isConnectFailure(error) ? 'database_unreachable' : 'database_error';
}

function isConnectFailure(error: unknown, depth = 0): boolean {
  if (depth > 4 || error === null || typeof error !== 'object') return false;
  if (error instanceof DatabaseConnectError) return true;
  return isConnectFailure((error as { cause?: unknown }).cause, depth + 1);
}

/**
 * Whether the database server reported the statement as unsupported: SQLSTATE
 * 0A000, or the MySQL error numbers for it. Codes only, as in checks-php.
 */
export function isUnsupported(error: unknown): boolean {
  return codes(error).includes('0A000') || errnos(error).some((errno) => MYSQL_UNSUPPORTED.has(errno));
}

/** `code` properties of the error, its causes and aggregated errors (bounded). */
function codes(error: unknown, depth = 0): string[] {
  if (depth > 4 || error === null || typeof error !== 'object') return [];
  const found: string[] = [];
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') found.push(code);
  // mysql2 carries the SQLSTATE next to its string code.
  const sqlState = (error as { sqlState?: unknown }).sqlState;
  if (typeof sqlState === 'string') found.push(sqlState);
  const nested = (error as { errors?: unknown }).errors;
  if (Array.isArray(nested)) for (const inner of nested.slice(0, 8)) found.push(...codes(inner, depth + 1));
  found.push(...codes((error as { cause?: unknown }).cause, depth + 1));
  return found;
}

/** Numeric `errno` properties (mysql2 and compatible drivers), from the error and its causes (bounded). */
function errnos(error: unknown, depth = 0): number[] {
  if (depth > 4 || error === null || typeof error !== 'object') return [];
  const found: number[] = [];
  const errno = (error as { errno?: unknown }).errno;
  if (typeof errno === 'number') found.push(errno);
  const nested = (error as { errors?: unknown }).errors;
  if (Array.isArray(nested)) for (const inner of nested.slice(0, 8)) found.push(...errnos(inner, depth + 1));
  found.push(...errnos((error as { cause?: unknown }).cause, depth + 1));
  return found;
}
