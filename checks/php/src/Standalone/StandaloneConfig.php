<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Standalone;

use Closure;
use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\Environment;
use RuntimeException;

/**
 * Reads `deploy-report.php` from the app root: a PHP file that returns an
 * array. `tier` must be a literal in that file; `token` and `run_id`
 * default to DEPLOY_REPORT_TOKEN and DEPLOY_RUN_ID.
 *
 *   return [
 *       'tier' => 'public',
 *       'checks' => ['database' => ['expected' => 'mysql'], 'scheduler' => [], 'storage' => [], 'env' => ['required' => ['APP_ENV']]],
 *       'database' => fn (): PDO => new PDO(...),   // the app's own connection
 *   ];
 */
final class StandaloneConfig
{
    public const FILE = 'deploy-report.php';

    private function __construct(
        public readonly string $appRoot,
        public readonly Config $config,
        public readonly string $markerPath,
        public readonly ?Closure $database,
    ) {
    }

    public static function load(string $appRoot): self
    {
        $appRoot = rtrim($appRoot, '/');
        $file = $appRoot.'/'.self::FILE;
        if (! is_file($file)) {
            throw new RuntimeException('deploy-report.php was not found in the app root');
        }

        $options = (static fn (string $path): mixed => require $path)($file);
        if (! is_array($options)) {
            throw new RuntimeException('deploy-report.php must return an array');
        }

        return self::fromArray($appRoot, $options);
    }

    /** @param array<string, mixed> $options */
    public static function fromArray(string $appRoot, array $options): self
    {
        $checks = $options['checks'] ?? null;
        $database = $options['database'] ?? null;

        $config = new Config(
            storePath: self::string($options['store_path'] ?? null) ?? $appRoot.'/storage/deploy-report',
            checks: is_array($checks) ? $checks : self::infer($database !== null),
            tier: ($options['tier'] ?? null) === 'full' ? 'full' : 'public',
            token: array_key_exists('token', $options) ? self::string($options['token']) : Environment::get('DEPLOY_REPORT_TOKEN'),
            runId: array_key_exists('run_id', $options) ? self::string($options['run_id']) : Environment::get('DEPLOY_RUN_ID'),
            appName: self::string($options['name'] ?? null),
            double: self::string($options['double'] ?? null),
            framework: null,
        );

        return new self(
            $appRoot,
            $config,
            self::string($options['storage_marker_path'] ?? null) ?? $appRoot.'/storage/app/deploy-report',
            $database instanceof Closure ? $database : (is_callable($database) ? Closure::fromCallable($database) : null),
        );
    }

    /** @return array<string, array<string, mixed>> */
    private static function infer(bool $hasDatabase): array
    {
        $checks = $hasDatabase ? ['database' => []] : [];

        return $checks + ['scheduler' => [], 'scheduler.release' => [], 'storage' => []];
    }

    private static function string(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }
}
