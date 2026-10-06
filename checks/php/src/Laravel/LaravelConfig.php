<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Laravel;

use DeployDoubles\Checks\Config;
use Illuminate\Contracts\Foundation\Application;

/**
 * Builds the core Config from Laravel's config repository. `tier` is read
 * from the committed config file only; it is never looked up in the
 * environment.
 */
final class LaravelConfig
{
    public static function make(Application $app): Config
    {
        $config = $app['config'];
        $tier = $config->get('deploy-report.tier') === 'full' ? 'full' : 'public';
        $checks = $config->get('deploy-report.checks');

        return new Config(
            storePath: (string) ($config->get('deploy-report.store_path') ?: $app->storagePath('deploy-report')),
            checks: is_array($checks) ? $checks : self::infer($app),
            tier: $tier,
            token: self::string($config->get('deploy-report.token')),
            runId: self::string($config->get('deploy-report.run_id')),
            appName: self::string($config->get('deploy-report.name')),
            double: self::string($config->get('deploy-report.double')),
            framework: self::framework($app),
        );
    }

    /** @return array<string, array<string, mixed>> */
    private static function infer(Application $app): array
    {
        $config = $app['config'];
        $checks = [];

        $connection = $config->get('database.default');
        $driver = $connection ? $config->get("database.connections.$connection.driver") : null;
        if (is_string($driver)) {
            $checks['database'] = ['expected' => self::databaseEngine($driver)];
        }

        $store = $config->get('cache.default');
        $cacheDriver = $store ? $config->get("cache.stores.$store.driver") : null;
        if (is_string($cacheDriver) && ! in_array($cacheDriver, ['null', 'array'], true)) {
            $checks['cache'] = ['expected' => $cacheDriver];
        }

        $queue = $config->get('queue.default');
        $queueDriver = $queue ? $config->get("queue.connections.$queue.driver") : null;
        if (is_string($queueDriver) && ! in_array($queueDriver, ['sync', 'null', 'deferred', 'background'], true)) {
            $checks['queue'] = ['expected' => $queueDriver];
            $checks['queue.release'] = [];
        }

        $checks['scheduler'] = [];
        $checks['scheduler.release'] = [];
        $checks['storage'] = [];
        $checks['env'] = ['required' => ['APP_KEY']];

        return $checks;
    }

    public static function databaseEngine(string $driver): string
    {
        return match ($driver) {
            'pgsql' => 'postgres',
            default => $driver,
        };
    }

    private static function framework(Application $app): ?string
    {
        return preg_match('/^(\d+)\.(\d+)/', $app->version(), $m) ? 'laravel '.$m[1].'.'.$m[2] : 'laravel';
    }

    private static function string(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }
}
