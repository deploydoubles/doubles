<?php

use function DeployDoubles\Checks\appRoot;
use function DeployDoubles\Checks\run;
use function DeployDoubles\Checks\serve;

const PLAIN_COMMIT = 'dddddddddddddddddddddddddddddddddddddddd';
const PLAIN_TOKEN = 'plain-php-token-that-is-long-enough-0123456';

beforeEach(function () {
    $this->root = tempDir();
    $_SERVER['DEPLOY_COMMIT'] = PLAIN_COMMIT;
    $GLOBALS['dd_database_calls'] = 0;

    $this->config = function (string $body): void {
        file_put_contents($this->root.'/deploy-report.php', "<?php\n\n".$body);
    };

    $this->serve = function (array $server = []): array {
        $saved = $_SERVER;
        $_SERVER = $server + $_SERVER;
        ob_start();
        try {
            serve($this->root);
        } finally {
            $output = (string) ob_get_clean();
            $_SERVER = $saved;
        }

        return ['status' => http_response_code(), 'body' => $output, 'json' => json_decode($output, true)];
    };
});

afterEach(function () {
    unset($_SERVER['DEPLOY_COMMIT'], $_SERVER['DEPLOY_REPORT_TOKEN'], $_SERVER['DEPLOY_REPORT_TIER'], $_SERVER['APP_ENV']);
    http_response_code(200);
});

it('runs the checks from cron and serves them from the front controller', function () {
    $_SERVER['APP_ENV'] = 'production';
    ($this->config)(<<<'PHP'
        return [
            'tier' => 'full',
            'name' => 'plain',
            'checks' => ['database' => ['expected' => 'sqlite'], 'scheduler' => [], 'scheduler.release' => [], 'storage' => [], 'env' => ['required' => ['APP_ENV']]],
            'database' => function (): PDO { $GLOBALS['dd_database_calls']++; return new PDO('sqlite::memory:'); },
        ];
        PHP);

    expect(run($this->root))->toBe(0);
    $response = ($this->serve)();

    expect($response['status'])->toBe(200)
        ->and($response['json']['status'])->toBe('pass')
        ->and($response['json']['deploy']['tier'])->toBe('full')
        ->and($response['json']['deploy']['settled'])->toBeTrue()
        ->and($response['json']['deploy']['release']['commit'])->toBe(PLAIN_COMMIT)
        ->and($response['json']['deploy']['checks']['database']['observed'])->toStartWith('sqlite')
        ->and($response['json']['deploy']['checks']['env']['status'])->toBe('pass')
        ->and($response['json']['deploy']['app'])->not->toHaveKey('framework')
        ->and(is_dir($this->root.'/storage/deploy-report'))->toBeTrue();
});

it('never touches the database when the report is read', function () {
    ($this->config)(<<<'PHP'
        return [
            'tier' => 'full',
            'checks' => ['database' => [], 'scheduler' => []],
            'database' => function (): PDO { $GLOBALS['dd_database_calls']++; return new PDO('sqlite::memory:'); },
        ];
        PHP);

    run($this->root);
    $calls = $GLOBALS['dd_database_calls'];
    ($this->serve)();
    ($this->serve)();

    expect($calls)->toBe(1)
        ->and($GLOBALS['dd_database_calls'])->toBe(1);
});

it('serves the public tier without a token, and the full tier with a valid one', function () {
    $_SERVER['DEPLOY_REPORT_TOKEN'] = PLAIN_TOKEN;
    $_SERVER['DEPLOY_REPORT_TIER'] = 'full';
    ($this->config)("return ['checks' => ['scheduler' => []]];");
    run($this->root);

    $public = ($this->serve)();
    $wrong = ($this->serve)(['HTTP_AUTHORIZATION' => 'Bearer '.str_repeat('y', strlen(PLAIN_TOKEN))]);
    $full = ($this->serve)(['HTTP_AUTHORIZATION' => 'Bearer '.PLAIN_TOKEN, 'HTTP_DEPLOY_RUN_ID' => 'whatever']);

    expect($public['json']['deploy']['tier'])->toBe('public')
        ->and($public['json']['deploy'])->not->toHaveKey('release')
        ->and($wrong['json']['deploy']['tier'])->toBe('public')
        ->and($full['json']['deploy']['tier'])->toBe('full')
        ->and($full['json']['deploy']['release']['run_id_match'])->toBeNull();
});

it('reports a forced database error as a fixed code with no username, host or DSN', function () {
    ($this->config)(<<<'PHP'
        return [
            'tier' => 'full',
            'checks' => ['database' => ['expected' => 'mysql'], 'scheduler' => []],
            'database' => fn (): PDO => new PDO('mysql:host=127.0.0.1;port=1;dbname=leaky_db', 'leaky_user', 'leaky_password'),
        ];
        PHP);

    run($this->root);
    $response = ($this->serve)();

    expect($response['status'])->toBe(503)
        ->and($response['json']['deploy']['checks']['database']['code'])->toBe('database_unreachable');
    foreach (['leaky_user', 'leaky_password', 'leaky_db', '127.0.0.1', 'mysql:host', 'SQLSTATE', 'refused', $this->root] as $secret) {
        expect($response['body'])->not->toContain($secret);
    }
})->skip(! extension_loaded('pdo_mysql'), 'needs pdo_mysql');

it('fails the scheduler when the runner never ran', function () {
    ($this->config)("return ['tier' => 'full', 'checks' => ['scheduler' => [], 'storage' => []]];");
    $commit = PLAIN_COMMIT;
    mkdir($this->root.'/storage/deploy-report', 0777, true);
    file_put_contents($this->root."/storage/deploy-report/boot-$commit.json", json_encode(['at' => time() - 121]));

    $response = ($this->serve)();

    expect($response['status'])->toBe(503)
        ->and(array_keys($response['json']['deploy']['checks']))->toBe(['scheduler'])
        ->and($response['json']['deploy']['checks']['scheduler']['code'])->toBe('scheduler_not_running');
});

it('fails clearly when the app has no deploy-report.php', function () {
    run($this->root);
})->throws(RuntimeException::class, 'deploy-report.php was not found');

it('finds the app root from the Composer autoloader', function () {
    expect(appRoot())->toBe(realpath(__DIR__.'/../..'));
});
