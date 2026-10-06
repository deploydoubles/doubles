<?php

use DeployDoubles\Checks\Laravel\RunCommand;

beforeEach(function () {
    $_SERVER['DEPLOY_COMMIT'] = str_repeat('a', 40);
});

afterEach(function () {
    unset($_SERVER['DEPLOY_COMMIT']);
});

it('reports a forced database error as a fixed code with no username, host or DSN', function () {
    config()->set('database.connections.leaky', [
        'driver' => 'mysql',
        'host' => '127.0.0.1',
        'port' => 1,
        'database' => 'leaky_db',
        'username' => 'leaky_user',
        'password' => 'leaky_password',
    ]);
    config()->set('database.default', 'leaky');
    config()->set('deploy-report.tier', 'full');
    config()->set('deploy-report.checks', ['database' => ['expected' => 'mysql'], 'scheduler' => []]);

    $this->artisan(RunCommand::NAME)->assertSuccessful();
    $response = $this->get('/.well-known/deploy-report');

    $response->assertStatus(503)
        ->assertJsonPath('deploy.checks.database.status', 'fail')
        ->assertJsonPath('deploy.checks.database.code', 'database_unreachable');

    foreach (['leaky_user', 'leaky_password', 'leaky_db', '127.0.0.1', 'mysql:host', 'SQLSTATE', 'Connection refused', base_path()] as $secret) {
        expect($response->getContent())->not->toContain($secret);
    }
});
