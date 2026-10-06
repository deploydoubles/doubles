/**
 * The fixed error codes of report v0.1 and the one fixed hint for each —
 * identical to checks-php (src/Codes.php). Hints are platform-neutral and never
 * contain anything from the never-include list in spec/security.md.
 */
export const HINTS = {
  database_unreachable: "The database did not accept a connection. Check that it is running and that the app's connection settings point to it.",
  database_auth_failed: "The database rejected the app's credentials. Check the database username and password the app is configured with.",
  database_missing: "The configured database does not exist. Create it, or point the app at the right database name.",
  database_migrations_pending: "Migrations have not been applied to this database. Run the app's migrations as part of the release.",
  database_write_failed: "The app connected but could not write and read back a value. Check that its database user may create temporary tables and insert rows.",
  database_write_unsupported: "The database server does not support temporary tables, so the write test was skipped. Nothing to do unless the app's own writes fail.",
  database_engine_mismatch: "The app is connected to a different database engine than it declares. Check which database the platform attached and the app's connection settings.",
  database_error: "The database check failed with an unexpected error. Check the app's own logs for the cause.",
  cache_unreachable: "The cache server did not accept a connection. Check that it is running and that the app's cache settings point to it.",
  cache_store_mismatch: "The app is using a different cache store than it declares, usually because its cache settings never reached it. Set the cache store in the app's environment.",
  cache_roundtrip_failed: "A value written to the cache could not be read back. Check that the cache server accepts writes and is not evicting immediately.",
  cache_error: "The cache check failed with an unexpected error. Check the app's own logs for the cause.",
  queue_driver_mismatch: "The app is using a different queue backend than it declares, usually because its queue settings never reached it. Set the queue connection in the app's environment.",
  queue_no_worker: "A probe job has waited more than two minutes without being processed. Start a queue worker for this release.",
  queue_release_mismatch: "The worker that processed the probe runs a different release. Restart the queue workers after each release so they load the new code.",
  queue_error: "The queue check could not dispatch its probe job. Check that the queue backend is reachable.",
  scheduler_not_running: "The scheduled checks have not run for this release. Start the app's scheduler for this release.",
  scheduler_results_stale: "The scheduled checks stopped running more than three minutes ago. Check that the app's scheduler is still running.",
  scheduler_release_mismatch: "Schedulers from more than one release ran in the same minute, so scheduled jobs run twice. Stop the previous release's scheduler.",
  report_store_unwritable: "The deploy report could not write to its result store, so no check can be timed. Check that the app's storage directory exists and is writable by the web process and the scheduler.",
  storage_not_writable: "The app could not write to its persistent storage. Check that the storage directory exists, is writable and is shared between releases.",
  storage_error: "The storage check failed with an unexpected error. Check the app's own logs for the cause.",
  assets_missing: "Built front-end assets are missing. Run the app's asset build as part of the deploy.",
  env_missing: "Required environment variables are missing. Set them in the app's environment and redeploy.",
  check_error: "The check failed with an unexpected error. Check the app's own logs for the cause.",
} as const;

export type Code = keyof typeof HINTS;

export function isCode(value: unknown): value is Code {
  return typeof value === "string" && Object.hasOwn(HINTS, value);
}

export function hint(code: Code): string {
  return HINTS[code];
}
