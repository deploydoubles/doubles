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
    unset($_SERVER['DEPLOY_COMMIT']);
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

it('ignores DEPLOY_REPORT_TIER-style environment variables set before the app boots', function () {
    // LaravelTestCase::setUp sets them before the app and the package config are loaded.
    expect(env('DEPLOY_REPORT_TIER'))->toBe('full');
    reportConfig(['token' => null]);

    $this->get('/.well-known/deploy-report')->assertJsonPath('deploy.tier', 'public');
});

it('keeps tier a literal in the shipped config files, never an env() call', function () {
    $files = array_filter([
        __DIR__.'/../../config/deploy-report.php',
        // The reference doubles, when this runs in the monorepo: Laravel's
        // published config, and the framework-less deploy-report.php.
        ...(glob(__DIR__.'/../../../../doubles/*/config/deploy-report.php') ?: []),
        ...(glob(__DIR__.'/../../../../doubles/*/deploy-report.php') ?: []),
    ], 'is_file');

    expect($files)->not->toBeEmpty();
    foreach ($files as $file) {
        $tokens = array_values(array_filter(
            token_get_all((string) file_get_contents($file)),
            static fn ($t) => ! is_array($t) || ! in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true),
        ));
        $found = false;
        foreach ($tokens as $i => $token) {
            if (is_array($token) && $token[0] === T_CONSTANT_ENCAPSED_STRING && trim($token[1], '\'"') === 'tier'
                && ($tokens[$i + 1][0] ?? null) === T_DOUBLE_ARROW) {
                $found = true;
                $value = $tokens[$i + 2];
                $next = $tokens[$i + 3];
                expect(is_array($value) && $value[0] === T_CONSTANT_ENCAPSED_STRING)->toBeTrue("tier in $file must be a string literal")
                    ->and($next)->toBe(',', "tier in $file must be a plain literal, not an expression");
            }
        }
        expect($found)->toBeTrue("no 'tier' key in $file");
    }
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
