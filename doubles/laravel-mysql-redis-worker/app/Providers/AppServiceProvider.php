<?php

namespace App\Providers;

use App\DoubleFailure;
use Illuminate\Console\Events\CommandStarting;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class AppServiceProvider extends ServiceProvider
{
    /** How long slow-boot answers 503 after the release's first web request. */
    private const SLOW_BOOT_SECONDS = 20;

    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->failOnPurpose();
    }

    /**
     * Deliberate failures (spec/failure-modes.md), each fired only when
     * DOUBLE_FAIL names this release's commit (App\DoubleFailure). The
     * request-stage mode (500) lives in routes/web.php, on "/" only.
     */
    private function failOnPurpose(): void
    {
        if ($this->app->runningInConsole()) {
            // build: package:discover runs while the dependencies install.
            // migrate: the release step.
            Event::listen(CommandStarting::class, function (CommandStarting $event): void {
                foreach (['build' => 'package:discover', 'migrate' => 'migrate'] as $mode => $command) {
                    if ($event->command === $command && DoubleFailure::is($mode)) {
                        throw new RuntimeException("Deliberate failure: DOUBLE_FAIL={$mode} stops `php artisan {$command}`.");
                    }
                }
            });

            return;
        }

        if (DoubleFailure::is('boot')) {
            throw new RuntimeException('Deliberate failure: DOUBLE_FAIL=boot fails every web request.');
        }

        if (DoubleFailure::is('slow-boot') && $this->secondsSinceFirstRequest() < self::SLOW_BOOT_SECONDS) {
            throw new HttpException(503, 'Deliberate failure: DOUBLE_FAIL=slow-boot is still starting.');
        }
    }

    /**
     * Seconds since this release's first web request. The first request
     * creates the marker (write once, keyed by commit); its mtime is the start.
     */
    private function secondsSinceFirstRequest(): int
    {
        $marker = storage_path('app/double-slow-boot-'.Str::after((string) config('double.fail'), '@'));

        $handle = @fopen($marker, 'x');
        if ($handle !== false) {
            fclose($handle);
        }

        clearstatcache(true, $marker);
        $started = @filemtime($marker);

        return $started === false ? 0 : time() - $started;
    }
}
