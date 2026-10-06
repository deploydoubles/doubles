<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Symfony;

use DeployDoubles\Checks\CommitResolver;
use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\FileStore;
use DeployDoubles\Checks\ReportReader;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\HttpKernel\Kernel;

/**
 * Builds the core Config from the bundle configuration. `tier` is read from
 * the committed config file only: an env placeholder there is a compile error.
 */
final class SymfonyConfig
{
    /**
     * Rejects anything but the literals 'public' and 'full' — in particular an
     * `%env(...)%` placeholder, so no platform variable can switch the tier.
     */
    public static function tier(mixed $value, ContainerBuilder $builder): string
    {
        $resolved = is_string($value) ? $builder->resolveEnvPlaceholders($value) : $value;
        if (! is_string($value) || $resolved !== $value || ! in_array($value, ['public', 'full'], true)) {
            throw new \InvalidArgumentException('deploy_report.tier must be the literal "public" or "full" in the committed configuration; environment variables are not accepted.');
        }

        return $value;
    }

    /**
     * @param  array{tier: string, token: mixed, run_id: mixed, name: mixed, double: mixed, store_path: mixed}  $options
     * @param  array<string, array<string, mixed>>|null  $checks
     */
    public static function make(array $options, ?array $checks): Config
    {
        return new Config(
            storePath: (string) $options['store_path'],
            checks: is_array($checks) ? $checks : [],
            tier: $options['tier'] === 'full' ? 'full' : 'public',
            token: self::string($options['token']),
            runId: self::string($options['run_id']),
            appName: self::string($options['name']),
            double: self::string($options['double']),
            framework: 'symfony '.Kernel::MAJOR_VERSION.'.'.Kernel::MINOR_VERSION,
        );
    }

    public static function store(Config $config): FileStore
    {
        return new FileStore($config->storePath);
    }

    public static function reader(FileStore $store, Config $config, CommitResolver $resolver): ReportReader
    {
        return new ReportReader($store, $config, $resolver->resolve());
    }

    private static function string(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }
}
