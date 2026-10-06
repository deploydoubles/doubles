<?php

use function DeployDoubles\Checks\appRoot;
use function DeployDoubles\Checks\run;
use function DeployDoubles\Checks\serve;

const PLAIN_COMMIT = 'dddddddddddddddddddddddddddddddddddddddd';
const PLAIN_TOKEN = 'plain-php-token-that-is-long-enough-0123456';

/** An SQLite connection that records every statement, and can refuse temporary tables the way Vitess does. */
final class RecordingPdo extends PDO
{
    /** @var list<string> */
    public static array $statements = [];

    public static bool $noTemporaryTables = false;

    public function exec(string $statement): int|false
    {
        self::$statements[] = $statement;
        if (self::$noTemporaryTables && str_starts_with($statement, 'CREATE TEMPORARY')) {
            $e = new PDOException('SQLSTATE[0A000]: Feature not supported: leaky_user@secret-host.internal');
            $e->errorInfo = ['0A000', 0, 'unsupported for leaky_user@secret-host.internal'];

            throw $e;
        }

        return parent::exec($statement);
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        self::$statements[] = $query;

        return parent::prepare($query, $options);
    }

    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        self::$statements[] = $query;

        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$fetchModeArgs);
    }
}

beforeEach(function () {
    $this->root = tempDir();
    $_SERVER['DEPLOY_COMMIT'] = PLAIN_COMMIT;
    $GLOBALS['dd_database_calls'] = 0;
    RecordingPdo::$statements = [];
    RecordingPdo::$noTemporaryTables = false;

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

it('ignores a token in the query string', function () {
    $_SERVER['DEPLOY_REPORT_TOKEN'] = PLAIN_TOKEN;
    ($this->config)("return ['checks' => ['scheduler' => []]];");
    run($this->root);

    $savedGet = $_GET;
    $_GET = ['token' => PLAIN_TOKEN, 'access_token' => PLAIN_TOKEN];
    try {
        $response = ($this->serve)([
            'QUERY_STRING' => 'token='.PLAIN_TOKEN.'&access_token='.PLAIN_TOKEN,
            'REQUEST_URI' => '/.well-known/deploy-report?token='.PLAIN_TOKEN,
        ]);
    } finally {
        $_GET = $savedGet;
    }

    expect($response['json']['deploy']['tier'])->toBe('public')
        ->and($response['json']['deploy'])->not->toHaveKey('release');
});

it('answers a fixed 503 when the report cannot be served, with display_errors off meanwhile and restored after', function () {
    ($this->config)(<<<'PHP'
        $GLOBALS['dd_display_errors_inside'] = ini_get('display_errors');
        throw new RuntimeException('leaky_user@db.internal.example:3306 /var/www/secret');
        PHP);
    $saved = ini_get('display_errors');
    ini_set('display_errors', '1');
    try {
        $response = ($this->serve)();
        $after = ini_get('display_errors');
    } finally {
        ini_set('display_errors', $saved === false ? '' : $saved);
    }

    expect($response['status'])->toBe(503)
        ->and($response['body'])->toBe('{"status":"fail","deploy":{"spec_version":"0.1","tier":"public","settled":true,"checks":{}}}')
        ->and($GLOBALS['dd_display_errors_inside'])->toBe('0')
        ->and($after)->toBe('1');
});

it('prints no error text into the response, even with display_errors on in php.ini', function () {
    // A real PHP process: PHPUnit's own error handler would hide a displayed warning in-process.
    file_put_contents($this->root.'/deploy-report.php', <<<'PHP'
        <?php
        echo $leaky_undefined_variable;
        trigger_error('leaky_user@db.internal.example', E_USER_WARNING);
        throw new RuntimeException('leaky_user@db.internal.example /var/www/secret');
        PHP);
    $script = sprintf(
        'require %s; DeployDoubles\Checks\serve(%s); echo "\n", http_response_code(), "|", ini_get("display_errors");',
        var_export(realpath(__DIR__.'/../../vendor/autoload.php'), true),
        var_export($this->root, true),
    );
    $process = proc_open([PHP_BINARY, '-d', 'display_errors=1', '-d', 'log_errors=0', '-r', $script], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    $stdout = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($process);

    expect($stdout)->toBe('{"status":"fail","deploy":{"spec_version":"0.1","tier":"public","settled":true,"checks":{}}}'."\n503|1");
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

it('skips the write test with database_write_unsupported when the server has no temporary tables', function () {
    RecordingPdo::$noTemporaryTables = true;
    ($this->config)(<<<'PHP'
        return [
            'tier' => 'full',
            'checks' => ['database' => ['expected' => 'sqlite'], 'scheduler' => []],
            'database' => fn (): PDO => new RecordingPdo('sqlite::memory:'),
        ];
        PHP);

    run($this->root);
    $response = ($this->serve)();

    expect($response['status'])->toBe(200)
        ->and($response['json']['status'])->toBe('pass')
        ->and($response['json']['deploy']['checks']['database']['status'])->toBe('skip')
        ->and($response['json']['deploy']['checks']['database']['code'])->toBe('database_write_unsupported')
        ->and($response['body'])->not->toContain('leaky_user')
        ->and($response['body'])->not->toContain('secret-host');
});

it('drops only the temporary probe table after the write test', function () {
    ($this->config)(<<<'PHP'
        return [
            'tier' => 'full',
            'checks' => ['database' => ['expected' => 'sqlite'], 'scheduler' => []],
            'database' => fn (): PDO => new RecordingPdo('sqlite::memory:'),
        ];
        PHP);

    run($this->root);

    expect(RecordingPdo::$statements)->toContain('DROP TABLE temp.deploy_report_probe')
        ->and(RecordingPdo::$statements)->not->toContain('DROP TABLE deploy_report_probe')
        ->and(($this->serve)()['json']['deploy']['checks']['database']['status'])->toBe('pass');
});

it('goes through the core runner: a returning release starts a fresh run, and stale results are dated to the last run', function () {
    ($this->config)("return ['tier' => 'full', 'checks' => ['scheduler' => [], 'storage' => []]];");
    $commit = PLAIN_COMMIT;
    $store = $this->root.'/storage/deploy-report';
    mkdir($store, 0777, true);
    $lastRun = time() - 600;
    // An earlier life of this commit: stale results, an old heartbeat and boot marker.
    file_put_contents("$store/results-$commit.json", json_encode(['commit' => $commit, 'since' => $lastRun - 60, 'ran_at' => $lastRun, 'checks' => []]));
    file_put_contents("$store/heartbeat-$commit.json", json_encode(['commit' => $commit, 'at' => $lastRun, 'first_minute' => intdiv($lastRun, 60) - 1, 'minutes' => [intdiv($lastRun, 60)]]));
    file_put_contents("$store/boot-$commit.json", json_encode(['at' => $lastRun - 60]));

    $stale = ($this->serve)()['json']['deploy']['checks']['scheduler'];
    expect($stale['code'])->toBe('scheduler_results_stale')
        ->and($stale['checked_at'])->toBe(gmdate('Y-m-d\TH:i:s\Z', $lastRun));

    $before = time();
    run($this->root);
    $results = json_decode((string) file_get_contents("$store/results-$commit.json"), true);
    $boot = json_decode((string) file_get_contents("$store/boot-$commit.json"), true);

    expect($results['since'])->toBeGreaterThanOrEqual($before)
        ->and($boot['at'])->toBeGreaterThanOrEqual($before)
        ->and(($this->serve)()['json']['status'])->toBe('pass');
});

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
