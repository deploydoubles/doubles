<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

/**
 * The fixed error codes of report v0.1 and the one fixed hint for each.
 *
 * Hints are platform-neutral and never contain anything from the
 * never-include list in spec/security.md.
 */
final class Codes
{
    public const DATABASE_UNREACHABLE = 'database_unreachable';
    public const DATABASE_AUTH_FAILED = 'database_auth_failed';
    public const DATABASE_MISSING = 'database_missing';
    public const DATABASE_MIGRATIONS_PENDING = 'database_migrations_pending';
    public const DATABASE_WRITE_FAILED = 'database_write_failed';
    public const DATABASE_ENGINE_MISMATCH = 'database_engine_mismatch';
    public const DATABASE_ERROR = 'database_error';
    public const CACHE_UNREACHABLE = 'cache_unreachable';
    public const CACHE_STORE_MISMATCH = 'cache_store_mismatch';
    public const CACHE_ROUNDTRIP_FAILED = 'cache_roundtrip_failed';
    public const CACHE_ERROR = 'cache_error';
    public const QUEUE_DRIVER_MISMATCH = 'queue_driver_mismatch';
    public const QUEUE_NO_WORKER = 'queue_no_worker';
    public const QUEUE_RELEASE_MISMATCH = 'queue_release_mismatch';
    public const QUEUE_ERROR = 'queue_error';
    public const SCHEDULER_NOT_RUNNING = 'scheduler_not_running';
    public const SCHEDULER_RESULTS_STALE = 'scheduler_results_stale';
    public const SCHEDULER_RELEASE_MISMATCH = 'scheduler_release_mismatch';
    public const STORAGE_NOT_WRITABLE = 'storage_not_writable';
    public const STORAGE_ERROR = 'storage_error';
    public const ASSETS_MISSING = 'assets_missing';
    public const ENV_MISSING = 'env_missing';
    public const CHECK_ERROR = 'check_error';

    private const HINTS = [
        self::DATABASE_UNREACHABLE => 'The database did not accept a connection. Check that it is running and that the app\'s connection settings point to it.',
        self::DATABASE_AUTH_FAILED => 'The database rejected the app\'s credentials. Check the database username and password the app is configured with.',
        self::DATABASE_MISSING => 'The configured database does not exist. Create it, or point the app at the right database name.',
        self::DATABASE_MIGRATIONS_PENDING => 'Migrations have not been applied to this database. Run the app\'s migrations as part of the release.',
        self::DATABASE_WRITE_FAILED => 'The app connected but could not write and read back a value. Check that its database user may create temporary tables and insert rows.',
        self::DATABASE_ENGINE_MISMATCH => 'The app is connected to a different database engine than it declares. Check which database the platform attached and the app\'s connection settings.',
        self::DATABASE_ERROR => 'The database check failed with an unexpected error. Check the app\'s own logs for the cause.',
        self::CACHE_UNREACHABLE => 'The cache server did not accept a connection. Check that it is running and that the app\'s cache settings point to it.',
        self::CACHE_STORE_MISMATCH => 'The app is using a different cache store than it declares, usually because its cache settings never reached it. Set the cache store in the app\'s environment.',
        self::CACHE_ROUNDTRIP_FAILED => 'A value written to the cache could not be read back. Check that the cache server accepts writes and is not evicting immediately.',
        self::CACHE_ERROR => 'The cache check failed with an unexpected error. Check the app\'s own logs for the cause.',
        self::QUEUE_DRIVER_MISMATCH => 'The app is using a different queue backend than it declares, usually because its queue settings never reached it. Set the queue connection in the app\'s environment.',
        self::QUEUE_NO_WORKER => 'A probe job has waited more than two minutes without being processed. Start a queue worker for this release.',
        self::QUEUE_RELEASE_MISMATCH => 'The worker that processed the probe runs a different release. Restart the queue workers after each release so they load the new code.',
        self::QUEUE_ERROR => 'The queue check could not dispatch its probe job. Check that the queue backend is reachable.',
        self::SCHEDULER_NOT_RUNNING => 'The scheduled checks have not run for this release. Start the app\'s scheduler for this release.',
        self::SCHEDULER_RESULTS_STALE => 'The scheduled checks stopped running more than three minutes ago. Check that the app\'s scheduler is still running.',
        self::SCHEDULER_RELEASE_MISMATCH => 'Schedulers from more than one release ran in the same minute, so scheduled jobs run twice. Stop the previous release\'s scheduler.',
        self::STORAGE_NOT_WRITABLE => 'The app could not write to its persistent storage. Check that the storage directory exists, is writable and is shared between releases.',
        self::STORAGE_ERROR => 'The storage check failed with an unexpected error. Check the app\'s own logs for the cause.',
        self::ASSETS_MISSING => 'Built front-end assets are missing. Run the app\'s asset build as part of the deploy.',
        self::ENV_MISSING => 'Required environment variables are missing. Set them in the app\'s environment and redeploy.',
        self::CHECK_ERROR => 'The check failed with an unexpected error. Check the app\'s own logs for the cause.',
    ];

    public static function isValid(string $code): bool
    {
        return isset(self::HINTS[$code]);
    }

    public static function hint(string $code): string
    {
        return self::HINTS[$code] ?? self::HINTS[self::CHECK_ERROR];
    }

    /** @return list<string> */
    public static function all(): array
    {
        return array_keys(self::HINTS);
    }
}
