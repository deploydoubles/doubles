<?php

use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\Laravel\RunCommand;
use Illuminate\Support\Facades\Log;

const LARAVEL_TOKEN = 'Zt7pQ2mX9vL4kR8nB3cW6yH1fD5gJ0sA';

beforeEach(function () {
    $_SERVER['DEPLOY_COMMIT'] = str_repeat('a', 40);
    config()->set('deploy-report.checks', ['scheduler' => [], 'storage' => []]);
    $this->artisan(RunCommand::NAME)->assertSuccessful();
});

afterEach(function () {
    unset($_SERVER['DEPLOY_COMMIT'], $_SERVER['DEPLOY_REPORT_TIER'], $_ENV['DEPLOY_REPORT_TIER']);
    putenv('DEPLOY_REPORT_TIER');
});

function reportConfig(array $overrides): void
{
    foreach ($overrides as $key => $value) {
        config()->set("deploy-report.$key", $value);
    }
    app()->forgetInstance(Config::class);
}

it('serves the public tier as health+json without a token', function () {
    reportConfig(['token' => LARAVEL_TOKEN]);

    $response = $this->get('/.well-known/deploy-report');

    $response->assertOk()
        ->assertHeader('Content-Type', 'application/health+json')
        ->assertJsonPath('deploy.tier', 'public')
        ->assertJsonMissingPath('deploy.release')
        ->assertJsonPath('deploy.checks.storage', ['status' => 'pass']);
});

it('serves the public tier for a wrong token of valid length', function () {
    reportConfig(['token' => LARAVEL_TOKEN]);

    $this->withHeader('Authorization', 'Bearer '.strrev(LARAVEL_TOKEN))
        ->get('/.well-known/deploy-report')
        ->assertJsonPath('deploy.tier', 'public');
});

it('serves the full tier for a valid bearer token', function () {
    reportConfig(['token' => LARAVEL_TOKEN]);

    $this->withHeader('Authorization', 'Bearer '.LARAVEL_TOKEN)
        ->get('/.well-known/deploy-report')
        ->assertJsonPath('deploy.tier', 'full')
        ->assertJsonPath('deploy.release.commit', str_repeat('a', 40));
});

it('ignores a token in the query string', function () {
    reportConfig(['token' => LARAVEL_TOKEN]);

    $this->get('/.well-known/deploy-report?token='.LARAVEL_TOKEN.'&access_token='.LARAVEL_TOKEN)
        ->assertJsonPath('deploy.tier', 'public');
});

it('serves the full tier without a token when the committed config sets tier full', function () {
    reportConfig(['tier' => 'full', 'token' => null]);

    $this->get('/.well-known/deploy-report')
        ->assertJsonPath('deploy.tier', 'full')
        ->assertJsonPath('deploy.release.commit', str_repeat('a', 40));
});

it('ignores DEPLOY_REPORT_TIER-style environment variables', function () {
    putenv('DEPLOY_REPORT_TIER=full');
    $_SERVER['DEPLOY_REPORT_TIER'] = $_ENV['DEPLOY_REPORT_TIER'] = 'full';
    reportConfig(['token' => null]);

    $this->get('/.well-known/deploy-report')->assertJsonPath('deploy.tier', 'public');
});

it('ignores a short token, serves the public tier and logs a warning without the token', function () {
    $short = 'too-short-token';
    reportConfig(['token' => $short]);
    Log::spy();

    $this->artisan(RunCommand::NAME)->assertSuccessful();
    $this->withHeader('Authorization', 'Bearer '.$short)
        ->get('/.well-known/deploy-report')
        ->assertJsonPath('deploy.tier', 'public');

    Log::shouldHaveReceived('warning')->withArgs(fn (string $message) => str_contains($message, 'DEPLOY_REPORT_TOKEN') && ! str_contains($message, $short))->atLeast()->once();
});
