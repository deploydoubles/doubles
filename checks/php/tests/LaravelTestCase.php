<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Tests;

use DeployDoubles\Checks\Laravel\DeployReportServiceProvider;
use Orchestra\Testbench\TestCase;

abstract class LaravelTestCase extends TestCase
{
    /**
     * Set before the app (and with it the package configuration) is built, in
     * every Laravel test: a platform may set such a variable, and it must never
     * switch on the full tier. Configuration that read it would turn the
     * public-tier tests red.
     *
     * Set in setUp() rather than defineEnvironment(): Testbench calls
     * defineEnvironment() after the service providers registered, which is
     * when mergeConfigFrom() evaluates the package's config file.
     */
    public const TIER_ENV = ['DEPLOY_REPORT_TIER', 'DEPLOY_REPORT_FULL', 'DEPLOYDOUBLES_TIER'];

    protected string $storeDir;

    protected function setUp(): void
    {
        foreach (self::TIER_ENV as $name) {
            putenv($name.'=full');
            $_SERVER[$name] = $_ENV[$name] = 'full';
        }

        parent::setUp();
    }

    protected function getPackageProviders($app): array
    {
        return [DeployReportServiceProvider::class];
    }

    protected function defineEnvironment($app): void
    {
        $this->storeDir = sys_get_temp_dir().'/dd-laravel-'.bin2hex(random_bytes(6));
        $app['config']->set('deploy-report.store_path', $this->storeDir.'/store');
        $app['config']->set('deploy-report.storage_marker_path', $this->storeDir.'/marker');
        $app['config']->set('database.default', 'testing');
        $app['config']->set('cache.default', 'array');
        $app['config']->set('queue.default', 'sync');
    }

    protected function tearDown(): void
    {
        parent::tearDown();

        foreach (self::TIER_ENV as $name) {
            putenv($name);
            unset($_SERVER[$name], $_ENV[$name]);
        }
    }
}
