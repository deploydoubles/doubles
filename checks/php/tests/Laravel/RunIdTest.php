<?php

use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\Laravel\RunCommand;

beforeEach(function () {
    $_SERVER['DEPLOY_COMMIT'] = str_repeat('a', 40);
    config()->set('deploy-report.checks', ['storage' => []]);
    config()->set('deploy-report.tier', 'full');
    $this->artisan(RunCommand::NAME)->assertSuccessful();
});

afterEach(function () {
    unset($_SERVER['DEPLOY_COMMIT']);
});

function withRunId(?string $runId): void
{
    config()->set('deploy-report.run_id', $runId);
    app()->forgetInstance(Config::class);
}

it('answers run_id_match true without echoing the value', function () {
    withRunId('run-7f3a9c1e');

    $response = $this->withHeader('Deploy-Run-Id', 'run-7f3a9c1e')->get('/.well-known/deploy-report');

    $response->assertJsonPath('deploy.release.run_id_match', true);
    expect($response->getContent())->not->toContain('run-7f3a9c1e');
});

it('answers run_id_match false for a different run ID', function () {
    withRunId('run-7f3a9c1e');

    $response = $this->withHeader('Deploy-Run-Id', 'run-other')->get('/.well-known/deploy-report');

    $response->assertJsonPath('deploy.release.run_id_match', false);
    expect($response->getContent())->not->toContain('run-7f3a9c1e')->not->toContain('run-other');
});

it('answers run_id_match null without DEPLOY_RUN_ID', function () {
    withRunId(null);

    $this->withHeader('Deploy-Run-Id', 'run-7f3a9c1e')
        ->get('/.well-known/deploy-report')
        ->assertJsonPath('deploy.release.run_id_match', null);
});
