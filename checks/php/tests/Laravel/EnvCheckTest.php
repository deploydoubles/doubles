<?php

/*
 * With `php artisan config:cache` — the usual production setup on most PHP
 * hosts — Laravel does not load .env, so env() cannot see a variable that
 * lives only there. The app still has it: its cached configuration was built
 * from that file.
 */

use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\Laravel\RunCommand;

const DOTENV_SECRET = 'value-that-must-never-appear-in-a-report';

beforeEach(function () {
    $_SERVER['DEPLOY_COMMIT'] = str_repeat('a', 40);
    unset($_SERVER['DD_ONLY_IN_DOTENV'], $_ENV['DD_ONLY_IN_DOTENV'], $_SERVER['DD_IN_PROCESS'], $_ENV['DD_IN_PROCESS']);
    putenv('DD_ONLY_IN_DOTENV');

    $this->envDir = tempDir();
    file_put_contents($this->envDir.'/.env', implode("\n", [
        'APP_NAME="a double"',
        'DD_ONLY_IN_DOTENV='.DOTENV_SECRET,
        'DD_EMPTY_IN_DOTENV=',
        'DD_NULL_IN_DOTENV=null',
        '',
    ]));
    app()->useEnvironmentPath($this->envDir);

    config()->set('deploy-report.tier', 'full');
});

afterEach(function () {
    unset($_SERVER['DEPLOY_COMMIT'], $_SERVER['DD_IN_PROCESS']);
});

function requireEnv(array $names): void
{
    config()->set('deploy-report.checks', ['env' => ['required' => $names], 'scheduler' => []]);
    app()->forgetInstance(Config::class);
}

function configIsCached(bool $cached): void
{
    // What Laravel's LoadConfiguration records when it boots from bootstrap/cache/config.php.
    app()->instance('config_loaded_from_cache', $cached);
}

it('finds a required variable that lives only in .env when the config is cached', function () {
    configIsCached(true);
    requireEnv(['DD_ONLY_IN_DOTENV']);

    $this->artisan(RunCommand::NAME)->assertSuccessful();
    $response = $this->get('/.well-known/deploy-report');

    $response->assertOk()->assertJsonPath('deploy.checks.env.status', 'pass');
    expect($response->getContent())->not->toContain(DOTENV_SECRET);
});

it('fails a variable that is empty or null in .env when the config is cached, naming it but not the file', function () {
    configIsCached(true);
    requireEnv(['DD_EMPTY_IN_DOTENV', 'DD_NULL_IN_DOTENV', 'DD_NOWHERE']);

    $this->artisan(RunCommand::NAME)->assertSuccessful();
    $response = $this->get('/.well-known/deploy-report');

    $response->assertStatus(503)
        ->assertJsonPath('deploy.checks.env.code', 'env_missing')
        ->assertJsonPath('deploy.checks.env.detail', 'missing: DD_EMPTY_IN_DOTENV, DD_NULL_IN_DOTENV, DD_NOWHERE');
    expect($response->getContent())->not->toContain(DOTENV_SECRET)
        ->and($response->getContent())->not->toContain($this->envDir);
});

it('reads the process environment first', function () {
    configIsCached(true);
    $_SERVER['DD_IN_PROCESS'] = 'set by the platform';
    requireEnv(['DD_IN_PROCESS', 'DD_ONLY_IN_DOTENV']);

    $this->artisan(RunCommand::NAME)->assertSuccessful();

    $this->get('/.well-known/deploy-report')->assertJsonPath('deploy.checks.env.status', 'pass');
});

it('does not read .env when the config is not cached, because Laravel loaded it then', function () {
    configIsCached(false);
    requireEnv(['DD_ONLY_IN_DOTENV']);

    $this->artisan(RunCommand::NAME)->assertSuccessful();

    $this->get('/.well-known/deploy-report')->assertJsonPath('deploy.checks.env.code', 'env_missing');
});
