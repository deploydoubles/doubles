<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Checks;

use Closure;
use DeployDoubles\Checks\CheckResult;
use DeployDoubles\Checks\Codes;
use DeployDoubles\Checks\ErrorMapper;
use DeployDoubles\Checks\Status;

/**
 * The database check's write test, shared by every adapter: create a
 * temporary table, write a value, read it back, drop only the temporary
 * table. A server without temporary tables skips the test with
 * database_write_unsupported; nothing here reads an exception message.
 */
final class WriteProbe
{
    private const TABLE = 'deploy_report_probe';

    /**
     * @param Closure(string): mixed $statement runs a statement without parameters
     * @param Closure(string, string): mixed $insert runs the insert with the value bound to its one placeholder
     * @param Closure(string): mixed $select runs the select and returns the value read back
     * @param string $engineOrDriver the engine (`mysql`, `postgres`, …) or PDO driver name (`pgsql`, …)
     * @param string $connected what the check proved before the write test, for the skip detail (e.g. `connected; 0 migrations pending`)
     * @return CheckResult|null null when the value round-tripped
     */
    public static function run(
        string $engineOrDriver,
        Closure $statement,
        Closure $insert,
        Closure $select,
        ?string $expected,
        ?string $observed,
        string $connected = 'connected',
    ): ?CheckResult {
        $value = bin2hex(random_bytes(8));

        try {
            $statement('CREATE TEMPORARY TABLE '.self::TABLE.' (v VARCHAR(32))');
        } catch (\Throwable $e) {
            if (ErrorMapper::isUnsupported($e)) {
                // Some servers (e.g. Vitess-based ones) have no temporary tables.
                // That is a limit of the test, not a fault of the deploy.
                return new CheckResult(Status::Skip, $expected, $observed, Codes::DATABASE_WRITE_UNSUPPORTED, $connected.'; no temporary tables on this server, write test skipped');
            }

            return CheckResult::fail(Codes::DATABASE_WRITE_FAILED, 'write then read failed', $expected, $observed);
        }

        try {
            $insert('INSERT INTO '.self::TABLE.' (v) VALUES (?)', $value);
            $read = $select('SELECT v FROM '.self::TABLE);
        } catch (\Throwable) {
            return CheckResult::fail(Codes::DATABASE_WRITE_FAILED, 'write then read failed', $expected, $observed);
        } finally {
            try {
                $statement(self::dropTemporaryTable($engineOrDriver));
            } catch (\Throwable) {
                // A temporary table ends with the session anyway.
            }
        }

        if ($read !== $value) {
            return CheckResult::fail(Codes::DATABASE_WRITE_FAILED, 'the value read back differs', $expected, $observed);
        }

        return null;
    }

    /**
     * Drops only the temporary table: a plain DROP TABLE on MySQL would drop a
     * real table of the same name, and would commit an open transaction.
     */
    public static function dropTemporaryTable(string $engineOrDriver): string
    {
        return match ($engineOrDriver) {
            'mysql', 'mariadb' => 'DROP TEMPORARY TABLE '.self::TABLE,
            'pgsql', 'postgres' => 'DROP TABLE pg_temp.'.self::TABLE,
            'sqlite' => 'DROP TABLE temp.'.self::TABLE,
            default => 'DROP TABLE '.self::TABLE,
        };
    }
}
