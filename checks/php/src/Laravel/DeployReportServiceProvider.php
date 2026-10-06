<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Laravel;

use DeployDoubles\Checks\CommitResolver;
use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\FileStore;
use DeployDoubles\Checks\Report;
use DeployDoubles\Checks\ReportReader;
use DeployDoubles\Checks\TierFilter;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\ServiceProvider;

final class DeployReportServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../../config/deploy-report.php', 'deploy-report');

        $this->app->singleton(Config::class, static fn (Application $app) => LaravelConfig::make($app));
        $this->app->singleton(FileStore::class, static fn (Application $app) => new FileStore($app->make(Config::class)->storePath));
        $this->app->bind(CommitResolver::class, static fn (Application $app) => new CommitResolver($app->basePath()));
        $this->app->bind(ReportReader::class, static fn (Application $app) => new ReportReader(
            $app->make(FileStore::class),
            $app->make(Config::class),
            $app->make(CommitResolver::class)->resolve(),
        ));
        $this->app->bind(TierFilter::class, static fn (Application $app) => new TierFilter($app->make(Config::class)));
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__.'/../../config/deploy-report.php' => $this->app->configPath('deploy-report.php'),
        ], 'deploy-report-config');

        $this->app['router']->get(Report::PATH, DeployReportController::class)->name('deploy-report');

        if ($this->app->runningInConsole()) {
            $this->commands([RunCommand::class]);
        }

        // No withoutOverlapping(): its mutex lives in the cache this command checks.
        $this->callAfterResolving(Schedule::class, static function (Schedule $schedule): void {
            $schedule->command(RunCommand::NAME)->everyMinute()->name('deploy-report');
        });
    }
}
