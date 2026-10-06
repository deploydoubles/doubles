<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Laravel;

use Closure;
use DeployDoubles\Checks\Checks\Engines;
use DeployDoubles\Checks\Checks\EnvCheck;
use DeployDoubles\Checks\Checks\StorageCheck;
use DeployDoubles\Checks\CheckResult;
use DeployDoubles\Checks\Codes;
use DeployDoubles\Checks\Config;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\Env;
use Illuminate\Support\Str;

/**
 * The run-time checks, implemented against Laravel's own database, cache and
 * queue configuration. Errors propagate to the Runner, which maps them to
 * fixed codes; nothing here reads an exception message.
 */
final class LaravelChecks
{
    public function __construct(
        private readonly Application $app,
        private readonly Config $config,
        private readonly ?string $commit,
    ) {
    }

    /** @return array<string, Closure(): CheckResult> */
    public function all(): array
    {
        return [
            'database' => $this->database(...),
            'cache' => $this->cache(...),
            'queue' => $this->queue(...),
            'storage' => fn () => (new StorageCheck($this->markerPath(), $this->commit))(),
            'env' => fn () => (new EnvCheck($this->config->requiredEnv(), static fn (string $name) => self::env($name)))(),
        ];
    }

    public function database(): CheckResult
    {
        $expected = $this->config->expected('database');
        $connection = $this->app['db']->connection();
        $observed = Engines::fromPdo($connection->getPdo());

        if (! Engines::satisfies($expected, Engines::engine($observed))) {
            return CheckResult::fail(Codes::DATABASE_ENGINE_MISMATCH, 'connected to a different engine than declared', $expected, $observed);
        }

        $pending = $this->pendingMigrations();
        if ($pending === null || $pending > 0) {
            return CheckResult::fail(
                Codes::DATABASE_MIGRATIONS_PENDING,
                $pending === null ? 'the migrations table does not exist' : $pending.' migration'.($pending === 1 ? '' : 's').' pending',
                $expected,
                $observed,
            );
        }

        $value = bin2hex(random_bytes(8));
        try {
            $connection->statement('CREATE TEMPORARY TABLE deploy_report_probe (v VARCHAR(32))');
            $connection->insert('INSERT INTO deploy_report_probe (v) VALUES (?)', [$value]);
            $read = $connection->selectOne('SELECT v FROM deploy_report_probe');
            $connection->statement('DROP TABLE deploy_report_probe');
        } catch (\Throwable) {
            return CheckResult::fail(Codes::DATABASE_WRITE_FAILED, 'write then read failed', $expected, $observed);
        }

        if (($read->v ?? null) !== $value) {
            return CheckResult::fail(Codes::DATABASE_WRITE_FAILED, 'the value read back differs', $expected, $observed);
        }

        return CheckResult::pass('connected; 0 migrations pending; write then read ok', $expected, $observed);
    }

    public function cache(): CheckResult
    {
        $expected = $this->config->expected('cache');
        $config = $this->app['config'];
        $storeName = (string) $config->get('cache.default');
        $driver = (string) $config->get("cache.stores.$storeName.driver");

        $observed = $driver === 'redis' ? $this->redisEngine((string) ($config->get("cache.stores.$storeName.connection") ?: 'cache')) : self::slug($driver);

        if ($expected !== null && ! ($driver === 'redis' ? Engines::satisfies($expected, Engines::engine($observed)) : $expected === $driver)) {
            return CheckResult::fail(Codes::CACHE_STORE_MISMATCH, 'the app is using a different cache store than declared', $expected, $observed);
        }

        $cache = $this->app['cache']->store();
        $key = 'deploy-report:probe:'.bin2hex(random_bytes(6));
        $value = bin2hex(random_bytes(8));
        $cache->put($key, $value, 60);
        $read = $cache->get($key);
        $cache->forget($key);

        if ($read !== $value) {
            return CheckResult::fail(Codes::CACHE_ROUNDTRIP_FAILED, 'the value read back differs', $expected, $observed);
        }

        return CheckResult::pass('value round-tripped through the cache store', $expected, $observed);
    }

    /** The run-time half of the queue check: is the backend the declared one? */
    public function queue(): CheckResult
    {
        $expected = $this->config->expected('queue');
        $config = $this->app['config'];
        $connection = (string) $config->get('queue.default');
        $driver = (string) $config->get("queue.connections.$connection.driver");

        $observed = $driver === 'redis'
            ? $this->redisEngine((string) ($config->get("queue.connections.$connection.connection") ?: 'default'))
            : self::slug($driver);

        $matches = $expected === null
            ? ! in_array($driver, ['sync', 'null', 'deferred', 'background'], true)
            : ($driver === 'redis' ? Engines::satisfies($expected, Engines::engine($observed)) : $expected === $driver);

        if (! $matches) {
            return CheckResult::fail(Codes::QUEUE_DRIVER_MISMATCH, 'the app is using a different queue backend than declared', $expected, $observed);
        }

        return CheckResult::pass('queue backend matches; probe dispatched', $expected, $observed);
    }

    private function redisEngine(string $connection): string
    {
        $redis = $this->app['redis']->connection($connection);
        $info = $redis->command('info', ['server']);
        if (is_array($info) && isset($info['Server']) && is_array($info['Server'])) {
            $info = $info['Server']; // Predis groups sections
        }

        return Engines::fromRedisInfo(is_array($info) ? $info : []);
    }

    private function pendingMigrations(): ?int
    {
        $migrator = $this->app['migrator'];
        $repository = $migrator->getRepository();
        if (! $repository->repositoryExists()) {
            return null;
        }

        $paths = array_merge([$this->app->databasePath('migrations')], $migrator->paths());
        $files = $migrator->getMigrationFiles($paths);
        $ran = $repository->getRan();

        return count(array_diff(array_keys($files), $ran));
    }

    private function markerPath(): string
    {
        $path = $this->app['config']->get('deploy-report.storage_marker_path');

        return is_string($path) && $path !== '' ? $path : $this->app->storagePath('app/deploy-report');
    }

    private static function env(string $name): ?string
    {
        $value = Env::get($name);

        return is_scalar($value) && (string) $value !== '' ? (string) $value : null;
    }

    private static function slug(string $driver): string
    {
        return Str::of($driver)->lower()->replaceMatches('/[^a-z0-9-]/', '')->value() ?: 'unknown';
    }
}
