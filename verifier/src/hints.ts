/**
 * Every hint the verifier prints comes from this file. Nothing a report says in free text (its
 * `hint` or `detail`) is ever printed: a report is remote input.
 */

/** Fixed, platform-neutral hints for outside checks and verifier conditions. */
export const HINTS = {
  unreachable:
    'No deploy report was served at /.well-known/deploy-report. Check that the app is running, that the URL routes to it, and that /.well-known/ paths reach the app.',
  crossOriginRedirect:
    'The report URL redirected to a different origin, which the verifier does not follow so that the token and run ID stay with the URL you gave. Pass the final URL directly.',
  tls: 'The TLS certificate is not valid for this host. Check that a certificate was issued and is served for this domain.',
  httpsRedirect: 'Plain HTTP does not redirect to HTTPS. Configure a permanent redirect from http:// to https://.',
  wrongRelease:
    'A different release is answering than the one deployed. Check that the deploy switched releases and that the previous release is no longer served.',
  unknownRelease:
    'The report did not say which release is answering. Pass --token to read the full report, or let the app resolve its commit (a platform variable, a REVISION file or the .git directory).',
  runId: "The app did not see this deploy's DEPLOY_RUN_ID. Check that environment variables reach the running release.",
  downtime: 'Requests failed while the release switched. Check that the new release is ready before traffic moves to it.',
  noSwitchSeen:
    'The new release was already serving when the measurement started, so no switch was measured. Start the verifier with --during-deploy before the deploy switches releases.',
  pending:
    "The check was still pending when the timeout passed. Use a longer --timeout, or check that the app's scheduler and workers are running.",
  notFresh:
    "The report's newest result was produced before this release was first seen, so it may describe an earlier deploy of the same commit. Wait for the app's next scheduled run (use a longer --timeout), or check that its scheduler is running.",
  inconsistent:
    "The report's overall status, its HTTP status and its checks disagree, or it uses check names outside the specification. Treat the deploy as failed and check the app's report implementation.",
  publicTier: 'The report is in its public tier, so it gives no reason. Pass --token to see the hint.',
  unknownCode: "The check failed without a code this verifier knows. Read the full report, or check the app's own logs.",
} as const;

/** One fixed hint per report code (spec/report.md, "Codes"). */
export const CODE_HINTS: Readonly<Record<string, string>> = {
  database_unreachable:
    "The database did not accept a connection. Check that it is running and that the app's connection settings point to it.",
  database_auth_failed: "The database rejected the app's credentials. Check the database username and password the app is configured with.",
  database_missing: 'The configured database does not exist. Create it, or point the app at the right database name.',
  database_migrations_pending: "Migrations have not been applied to this database. Run the app's migrations as part of the release.",
  database_write_failed:
    'The app connected but could not write and read back a value. Check that its database user may create temporary tables and insert rows.',
  database_write_unsupported:
    "The database server does not support temporary tables, so the write test was skipped. Nothing to do unless the app's own writes fail.",
  database_engine_mismatch:
    "The app is connected to a different database engine than it declares. Check which database the platform attached and the app's connection settings.",
  database_error: "The database check failed with an unexpected error. Check the app's own logs for the cause.",
  cache_unreachable: "The cache server did not accept a connection. Check that it is running and that the app's cache settings point to it.",
  cache_store_mismatch:
    "The app is using a different cache store than it declares, usually because its cache settings never reached it. Set the cache store in the app's environment.",
  cache_roundtrip_failed:
    'A value written to the cache could not be read back. Check that the cache server accepts writes and is not evicting immediately.',
  cache_error: "The cache check failed with an unexpected error. Check the app's own logs for the cause.",
  queue_driver_mismatch:
    "The app is using a different queue backend than it declares, usually because its queue settings never reached it. Set the queue connection in the app's environment.",
  queue_no_worker: 'A probe job has waited more than two minutes without being processed. Start a queue worker for this release.',
  queue_release_mismatch:
    'The worker that processed the probe runs a different release. Restart the queue workers after each release so they load the new code.',
  queue_error: 'The queue check could not dispatch its probe job. Check that the queue backend is reachable.',
  scheduler_not_running: "The scheduled checks have not run for this release. Start the app's scheduler for this release.",
  scheduler_results_stale:
    "The scheduled checks stopped running more than three minutes ago. Check that the app's scheduler is still running.",
  scheduler_release_mismatch:
    "Schedulers from more than one release ran in the same minute, so scheduled jobs run twice. Stop the previous release's scheduler.",
  report_store_unwritable:
    "The deploy report could not write to its result store, so no check can be timed. Check that the app's storage directory exists and is writable by the web process and the scheduler.",
  storage_not_writable:
    'The app could not write to its persistent storage. Check that the storage directory exists, is writable and is shared between releases.',
  storage_error: "The storage check failed with an unexpected error. Check the app's own logs for the cause.",
  assets_missing: "Built front-end assets are missing. Run the app's asset build as part of the deploy.",
  env_missing: "Required environment variables are missing. Set them in the app's environment and redeploy.",
  check_error: "The check failed with an unexpected error. Check the app's own logs for the cause.",
};

export function codeHint(code: unknown): string | undefined {
  return typeof code === 'string' && Object.hasOwn(CODE_HINTS, code) ? CODE_HINTS[code] : undefined;
}

/** Control characters, bidirectional overrides and zero-width characters: never printed. */
const UNPRINTABLE_RANGES: [number, number][] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];
const hex = (n: number): string => n.toString(16).padStart(4, '0');
const UNPRINTABLE = new RegExp(`[${UNPRINTABLE_RANGES.map(([a, b]) => `\\u${hex(a)}-\\u${hex(b)}`).join('')}]`, 'g');

export function printable(text: string): string {
  return text.replace(UNPRINTABLE, '');
}
