// The deploy report. The handler only reads the results the scheduler stored
// (instrumentation.ts); a request never runs a check or opens a connection.
export { GET } from '@deploydoubles/checks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
