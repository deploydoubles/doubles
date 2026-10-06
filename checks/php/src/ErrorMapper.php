<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

use PDOException;
use Throwable;

/**
 * Maps an error to a fixed code by its type and, for database errors, its
 * SQLSTATE or driver error number.
 *
 * It never reads an error's message and never walks nested errors for text:
 * driver messages routinely embed hostnames, usernames and DSNs.
 */
final class ErrorMapper
{
    /** MySQL/MariaDB client error numbers. */
    private const MYSQL_UNREACHABLE = [2002, 2003, 2005, 2006, 2013];
    private const MYSQL_AUTH = [1044, 1045, 1698];
    private const MYSQL_UNKNOWN_DATABASE = [1049];
    private const MYSQL_UNKNOWN_TABLE = [1146];
    /** ER_NOT_SUPPORTED_YET (also Vitess), ER_GTID_UNSAFE_CREATE_DROP_TEMPORARY_TABLE_IN_TRANSACTION. */
    private const MYSQL_UNSUPPORTED = [1235, 1787];

    public static function map(string $check, Throwable $error): string
    {
        return match (strtok($check, '.')) {
            'database' => self::database($error),
            'cache' => self::cache($error),
            'queue' => Codes::QUEUE_ERROR,
            'storage' => Codes::STORAGE_ERROR,
            default => Codes::CHECK_ERROR,
        };
    }

    /** Whether the database server reported the statement as unsupported (SQLSTATE 0A000 or the MySQL equivalents). */
    public static function isUnsupported(Throwable $error): bool
    {
        [$sqlState, $driverCode] = self::sqlCodes($error);

        return $sqlState === '0A000' || in_array($driverCode, self::MYSQL_UNSUPPORTED, true);
    }

    private static function database(Throwable $error): string
    {
        [$sqlState, $driverCode] = self::sqlCodes($error);

        if ($driverCode !== null) {
            if (in_array($driverCode, self::MYSQL_UNREACHABLE, true)) {
                return Codes::DATABASE_UNREACHABLE;
            }
            if (in_array($driverCode, self::MYSQL_AUTH, true)) {
                return Codes::DATABASE_AUTH_FAILED;
            }
            if (in_array($driverCode, self::MYSQL_UNKNOWN_DATABASE, true)) {
                return Codes::DATABASE_MISSING;
            }
            if (in_array($driverCode, self::MYSQL_UNKNOWN_TABLE, true)) {
                return Codes::DATABASE_MIGRATIONS_PENDING;
            }
        }

        if ($sqlState !== null) {
            return match (true) {
                $sqlState === '3D000' => Codes::DATABASE_MISSING,
                str_starts_with($sqlState, '28') => Codes::DATABASE_AUTH_FAILED,
                // 57P03: the server is starting up or shutting down, so it did not accept the connection.
                str_starts_with($sqlState, '08'), $sqlState === '57P03' => Codes::DATABASE_UNREACHABLE,
                in_array($sqlState, ['42S02', '42P01'], true) => Codes::DATABASE_MIGRATIONS_PENDING,
                default => Codes::DATABASE_ERROR,
            };
        }

        return Codes::DATABASE_ERROR;
    }

    private static function cache(Throwable $error): string
    {
        return self::isConnectionError($error) ? Codes::CACHE_UNREACHABLE : Codes::CACHE_ERROR;
    }

    private static function isConnectionError(Throwable $error): bool
    {
        // Matched by class name only, so the check works without the Redis
        // extension or Predis installed.
        for ($e = $error, $depth = 0; $e !== null && $depth < 5; $e = $e->getPrevious(), $depth++) {
            $class = get_class($e);
            if ($class === 'RedisException' || $class === 'RedisClusterException'
                || str_starts_with($class, 'Predis\\Connection\\')
                || str_ends_with($class, 'ConnectionException')) {
                return true;
            }
        }

        return false;
    }

    /**
     * SQLSTATE and driver error number, from codes only.
     *
     * @return array{0: ?string, 1: ?int}
     */
    private static function sqlCodes(Throwable $error): array
    {
        for ($e = $error, $depth = 0; $e !== null && $depth < 5; $e = $e->getPrevious(), $depth++) {
            if (! $e instanceof PDOException) {
                continue;
            }
            $info = $e->errorInfo;
            $sqlState = is_array($info) && is_string($info[0] ?? null) ? $info[0] : null;
            $driverCode = is_array($info) && is_int($info[1] ?? null) ? $info[1] : null;

            $code = $e->getCode();
            if ($driverCode === null && is_int($code) && $code > 0) {
                $driverCode = $code;
            }
            if ($sqlState === null && is_string($code) && preg_match('/^[0-9A-Z]{5}$/', $code)) {
                $sqlState = $code;
            }

            if ($sqlState !== null || $driverCode !== null) {
                return [$sqlState, $driverCode];
            }
        }

        return [null, null];
    }
}
