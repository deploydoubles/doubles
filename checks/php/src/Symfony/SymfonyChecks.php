<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Symfony;

use Closure;
use DeployDoubles\Checks\CheckResult;
use DeployDoubles\Checks\Checks\Engines;
use DeployDoubles\Checks\Checks\EnvCheck;
use DeployDoubles\Checks\Checks\StorageCheck;
use DeployDoubles\Checks\Codes;
use DeployDoubles\Checks\Config;
use Doctrine\DBAL\Connection;
use Doctrine\Migrations\DependencyFactory;
use PDO;
use Psr\Container\ContainerInterface;

/**
 * The run-time checks, implemented against the app's Doctrine connection and
 * Messenger transports. Errors propagate to the Runner, which maps them to
 * fixed codes; nothing here reads an exception message.
 */
final class SymfonyChecks
{
    /** Transports that never reach a worker. */
    private const IN_PROCESS = ['sync', 'in-memory'];

    public function __construct(
        private readonly Config $config,
        private readonly ?string $commit,
        private readonly string $markerPath,
        private readonly string $probeTransport,
        private readonly ?Connection $connection,
        private readonly ?DependencyFactory $migrations,
        private readonly ?ContainerInterface $transports,
    ) {}

    /** @return array<string, Closure(): CheckResult> */
    public function all(): array
    {
        $checks = [
            'queue' => $this->queue(...),
            'storage' => fn () => (new StorageCheck($this->markerPath, $this->commit))(),
            'env' => fn () => (new EnvCheck($this->config->requiredEnv()))(),
        ];
        if ($this->connection !== null) {
            $checks['database'] = $this->database(...);
        }

        return $checks;
    }

    public function database(): CheckResult
    {
        $expected = $this->config->expected('database');
        $connection = $this->connection ?? throw new \LogicException('no connection');
        $native = $connection->getNativeConnection();
        $observed = $native instanceof PDO ? Engines::fromPdo($native) : self::engineFromDriver($connection);

        if (! Engines::satisfies($expected, Engines::engine($observed))) {
            return CheckResult::fail(Codes::DATABASE_ENGINE_MISMATCH, 'connected to a different engine than declared', $expected, $observed);
        }

        $pending = $this->pendingMigrations();
        if ($pending !== null && $pending > 0) {
            return CheckResult::fail(
                Codes::DATABASE_MIGRATIONS_PENDING,
                $pending.' migration'.($pending === 1 ? '' : 's').' pending',
                $expected,
                $observed,
            );
        }

        $value = bin2hex(random_bytes(8));
        try {
            $connection->executeStatement('CREATE TEMPORARY TABLE deploy_report_probe (v VARCHAR(32))');
            $connection->executeStatement('INSERT INTO deploy_report_probe (v) VALUES (?)', [$value]);
            $read = $connection->fetchOne('SELECT v FROM deploy_report_probe');
            $connection->executeStatement('DROP TABLE deploy_report_probe');
        } catch (\Throwable) {
            return CheckResult::fail(Codes::DATABASE_WRITE_FAILED, 'write then read failed', $expected, $observed);
        }

        if ($read !== $value) {
            return CheckResult::fail(Codes::DATABASE_WRITE_FAILED, 'the value read back differs', $expected, $observed);
        }

        return CheckResult::pass(
            ($pending === null ? 'connected' : 'connected; 0 migrations pending').'; write then read ok',
            $expected,
            $observed,
        );
    }

    /** The run-time half of the queue check: is the probe transport the declared backend? */
    public function queue(): CheckResult
    {
        $expected = $this->config->expected('queue');

        if ($this->transports === null || ! $this->transports->has($this->probeTransport)) {
            return CheckResult::fail(Codes::QUEUE_DRIVER_MISMATCH, 'the probe transport is not configured', $expected, null);
        }

        $observed = self::transportKind($this->transports->get($this->probeTransport));

        $matches = $expected === null
            ? ! in_array($observed, self::IN_PROCESS, true)
            : Engines::satisfies($expected, $observed);

        if (! $matches) {
            return CheckResult::fail(Codes::QUEUE_DRIVER_MISMATCH, 'the app is using a different queue backend than declared', $expected, $observed);
        }

        return CheckResult::pass('queue backend matches; probe dispatched', $expected, $observed);
    }

    /** `database`, `redis`, `amqp`, `sync`, … — from the transport's class, never from its DSN. */
    public static function transportKind(object $transport): string
    {
        $short = strtolower((new \ReflectionClass($transport))->getShortName());

        return match (true) {
            str_starts_with($short, 'doctrine') => 'database',
            str_starts_with($short, 'redis') => 'redis',
            str_starts_with($short, 'amqp') => 'amqp',
            str_starts_with($short, 'sync') => 'sync',
            str_starts_with($short, 'inmemory') => 'in-memory',
            default => preg_replace('/[^a-z0-9-]/', '', preg_replace('/transport$/', '', $short) ?? '') ?: 'unknown',
        };
    }

    private function pendingMigrations(): ?int
    {
        if ($this->migrations === null) {
            return null;
        }

        return count($this->migrations->getMigrationStatusCalculator()->getNewMigrations());
    }

    private static function engineFromDriver(Connection $connection): string
    {
        $driver = strtolower((string) ($connection->getParams()['driver'] ?? ''));

        return match (true) {
            str_contains($driver, 'pgsql') => 'postgres',
            str_contains($driver, 'mysql') => 'mysql',
            str_contains($driver, 'sqlite') => 'sqlite',
            default => 'unknown',
        };
    }
}
