<?php

use DeployDoubles\Checks\Laravel\ProbeJob;
use DeployDoubles\Checks\Laravel\RunCommand;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $_SERVER['DEPLOY_COMMIT'] = str_repeat('a', 40);
});

afterEach(function () {
    unset($_SERVER['DEPLOY_COMMIT']);
});

it('runs no query and dispatches no job when the report is read', function () {
    config()->set('deploy-report.tier', 'full');
    config()->set('deploy-report.checks', ['database' => ['expected' => 'sqlite'], 'scheduler' => [], 'storage' => []]);
    $this->artisan('migrate')->run();
    $this->artisan(RunCommand::NAME)->assertSuccessful();

    Queue::fake();
    $queries = 0;
    DB::listen(function () use (&$queries) {
        $queries++;
    });

    $first = $this->get('/.well-known/deploy-report');
    $first->assertOk();
    $this->get('/.well-known/deploy-report')->assertOk();

    expect($queries)->toBe(0);
    Queue::assertNothingPushed();
});

it('runs the Laravel checks on a working sqlite app and passes', function () {
    config()->set('deploy-report.tier', 'full');
    config()->set('deploy-report.checks', [
        'database' => ['expected' => 'sqlite'],
        'cache' => ['expected' => 'array'],
        'scheduler' => [],
        'scheduler.release' => [],
        'storage' => [],
        'env' => ['required' => ['DEPLOY_COMMIT']],
    ]);
    $this->artisan('migrate')->run();
    $this->artisan(RunCommand::NAME)->assertSuccessful();

    $response = $this->get('/.well-known/deploy-report');

    $response->assertOk()
        ->assertJsonPath('status', 'pass')
        ->assertJsonPath('deploy.settled', true)
        ->assertJsonPath('deploy.checks.database.status', 'pass')
        ->assertJsonPath('deploy.checks.database.expected', 'sqlite')
        ->assertJsonPath('deploy.checks.cache.status', 'pass')
        ->assertJsonPath('deploy.checks.env.status', 'pass')
        ->assertJsonPath('deploy.app.framework', fn (string $v) => str_starts_with($v, 'laravel '));
});

it('fails the queue check when the queue silently runs synchronously', function () {
    config()->set('deploy-report.tier', 'full');
    config()->set('deploy-report.checks', ['queue' => ['expected' => 'redis'], 'queue.release' => [], 'scheduler' => []]);
    config()->set('queue.default', 'sync');
    $this->artisan(RunCommand::NAME)->assertSuccessful();

    $this->get('/.well-known/deploy-report')
        ->assertStatus(503)
        ->assertJsonPath('deploy.checks.queue.status', 'fail')
        ->assertJsonPath('deploy.checks.queue.code', 'queue_driver_mismatch');
});

it('answers the probe with the worker commit when the job runs', function () {
    config()->set('deploy-report.tier', 'full');
    config()->set('deploy-report.checks', ['queue' => ['expected' => 'database'], 'queue.release' => [], 'scheduler' => []]);
    config()->set('queue.default', 'database');
    config()->set('queue.connections.database', ['driver' => 'database', 'table' => 'jobs', 'queue' => 'default', 'retry_after' => 90]);
    $this->artisan('migrate')->run();

    Queue::fake();
    $this->artisan(RunCommand::NAME)->assertSuccessful();
    $pushed = Queue::pushed(ProbeJob::class);
    expect($pushed)->toHaveCount(1);

    $this->get('/.well-known/deploy-report')->assertJsonPath('deploy.checks.queue.status', 'pending');

    app()->call([$pushed->first(), 'handle']);

    $checks = $this->get('/.well-known/deploy-report')->assertOk()->json('deploy.checks');

    expect($checks['queue']['status'])->toBe('pass')
        ->and($checks['queue.release']['status'])->toBe('pass');
});

it('registers the run command on the schedule every minute, in the background', function () {
    $schedule = app(\Illuminate\Console\Scheduling\Schedule::class);
    $events = collect($schedule->events())->filter(fn ($e) => str_contains($e->command ?? '', RunCommand::NAME));

    expect($events)->toHaveCount(1)
        ->and($events->first()->expression)->toBe('* * * * *')
        ->and($events->first()->runInBackground)->toBeTrue()
        ->and($events->first()->withoutOverlapping)->toBeFalse();
});
