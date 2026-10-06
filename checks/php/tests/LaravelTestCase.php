<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Tests;

use DeployDoubles\Checks\Laravel\DeployReportServiceProvider;
use Orchestra\Testbench\TestCase;

abstract class LaravelTestCase extends TestCase
{
    protected string $storeDir;

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
}
