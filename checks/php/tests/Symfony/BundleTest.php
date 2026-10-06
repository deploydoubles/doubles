<?php

use DeployDoubles\Checks\Symfony\ProbeHandler;
use DeployDoubles\Checks\Symfony\ProbeMessage;
use DeployDoubles\Checks\Symfony\RunCommand;
use DeployDoubles\Checks\Symfony\SymfonyChecks;
use DeployDoubles\Checks\Tests\SymfonyTestKernel;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Messenger\Transport\InMemory\InMemoryTransport;

const SF_COMMIT = 'cccccccccccccccccccccccccccccccccccccccc';
const SF_TOKEN = 'symfony-token-that-is-long-enough-0123456789';

beforeEach(function () {
    $this->dir = tempDir();
    $_SERVER['DEPLOY_COMMIT'] = SF_COMMIT;
    $_SERVER['APP_SECRET'] = 'test-secret';
    $this->kernels = [];

    $this->kernel = function (array $deployReport, string $dsn = 'in-memory://', ?array $connection = null): SymfonyTestKernel {
        $deployReport += [
            'store_path' => $this->dir.'/store',
            'storage_marker_path' => $this->dir.'/marker',
        ];
        $kernel = new SymfonyTestKernel($this->dir, $deployReport, $dsn, $connection);
        $kernel->boot();
        $this->kernels[] = $kernel;

        return $kernel;
    };

    $this->get = function (SymfonyTestKernel $kernel, array $headers = []): Response {
        $request = Request::create('/.well-known/deploy-report');
        foreach ($headers as $name => $value) {
            $request->headers->set($name, $value);
        }

        return $kernel->handle($request);
    };

    $this->run = function (SymfonyTestKernel $kernel): string {
        $application = new Application($kernel);
        $tester = new CommandTester($application->find(RunCommand::NAME));
        $tester->execute([]);
        expect($tester->getStatusCode())->toBe(0);

        return $tester->getDisplay();
    };
});

afterEach(function () {
    foreach ($this->kernels as $kernel) {
        $kernel->shutdown();
    }
    unset($_SERVER['DEPLOY_COMMIT'], $_SERVER['APP_SECRET'], $_SERVER['DEPLOY_REPORT_TOKEN'], $_SERVER['DEPLOY_REPORT_TIER']);
});

it('serves the report without a route import, as health+json', function () {
    $kernel = ($this->kernel)(['tier' => 'full', 'checks' => ['scheduler' => [], 'storage' => []]]);
    ($this->run)($kernel);

    $response = ($this->get)($kernel);
    $body = json_decode((string) $response->getContent(), true);

    expect($response->getStatusCode())->toBe(200)
        ->and($response->headers->get('Content-Type'))->toBe('application/health+json')
        ->and($response->headers->get('Cache-Control'))->toContain('no-store')
        ->and($body['status'])->toBe('pass')
        ->and($body['deploy']['tier'])->toBe('full')
        ->and($body['deploy']['release']['commit'])->toBe(SF_COMMIT)
        ->and($body['deploy']['app']['framework'])->toStartWith('symfony ')
        ->and($body['deploy']['checks']['storage']['status'])->toBe('pass');
});

it('serves the public tier without a token, and the full tier with a valid one', function () {
    $_SERVER['DEPLOY_REPORT_TOKEN'] = SF_TOKEN;
    $kernel = ($this->kernel)(['checks' => ['scheduler' => []]]);
    ($this->run)($kernel);

    $public = json_decode((string) ($this->get)($kernel)->getContent(), true);
    $wrong = json_decode((string) ($this->get)($kernel, ['Authorization' => 'Bearer '.str_repeat('x', strlen(SF_TOKEN))])->getContent(), true);
    $full = json_decode((string) ($this->get)($kernel, ['Authorization' => 'Bearer '.SF_TOKEN])->getContent(), true);

    expect($public['deploy']['tier'])->toBe('public')
        ->and($public['deploy'])->not->toHaveKey('release')
        ->and($wrong['deploy']['tier'])->toBe('public')
        ->and($full['deploy']['tier'])->toBe('full')
        ->and($full['deploy']['release']['commit'])->toBe(SF_COMMIT);
});

it('ignores a token in the query string', function () {
    $_SERVER['DEPLOY_REPORT_TOKEN'] = SF_TOKEN;
    $kernel = ($this->kernel)(['checks' => ['scheduler' => []]]);
    ($this->run)($kernel);

    $response = $kernel->handle(Request::create('/.well-known/deploy-report?token='.SF_TOKEN.'&access_token='.SF_TOKEN));
    $body = json_decode((string) $response->getContent(), true);

    expect($body['deploy']['tier'])->toBe('public')
        ->and($body['deploy'])->not->toHaveKey('release');
});

it('rejects an environment variable as the tier', function () {
    $_SERVER['DEPLOY_REPORT_TIER'] = 'full';
    ($this->kernel)(['tier' => '%env(DEPLOY_REPORT_TIER)%']);
})->throws(InvalidArgumentException::class, 'environment variables are not accepted');

it('keeps tier a literal in the committed Symfony configs of the doubles, never an env placeholder', function () {
    // The reference doubles, when this runs in the monorepo.
    $files = [];
    foreach (glob(__DIR__.'/../../../../doubles/*/config/packages', GLOB_ONLYDIR) ?: [] as $dir) {
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if (preg_match('/\.ya?ml$/', $file->getFilename())) {
                $files[] = $file->getPathname();
            }
        }
    }
    if ($files === []) {
        $this->markTestSkipped('no Symfony doubles next to this package (read-only split)');
    }

    $found = 0;
    foreach ($files as $file) {
        // No flags: a !php/const or !php/object tag is a parse error, not a value.
        $yaml = Symfony\Component\Yaml\Yaml::parseFile($file);
        foreach (is_array($yaml) ? $yaml : [] as $key => $section) {
            $bundle = $key === 'deploy_report' ? $section : (str_starts_with((string) $key, 'when@') && is_array($section) ? ($section['deploy_report'] ?? null) : null);
            if (is_array($bundle) && array_key_exists('tier', $bundle)) {
                $found++;
                expect($bundle['tier'])->toBeIn(['public', 'full'], "tier in $file must be the literal public or full");
            }
        }
    }
    expect($found)->toBeGreaterThan(0);
});

it('ignores a DEPLOY_REPORT_TIER-style variable', function () {
    $_SERVER['DEPLOY_REPORT_TIER'] = 'full';
    $kernel = ($this->kernel)(['checks' => ['scheduler' => []]]);
    ($this->run)($kernel);

    expect(json_decode((string) ($this->get)($kernel)->getContent(), true)['deploy']['tier'])->toBe('public');
});

it('runs no check and sends no message when the report is read', function () {
    $kernel = ($this->kernel)(['tier' => 'full', 'checks' => ['queue' => ['expected' => 'in-memory'], 'queue.release' => [], 'scheduler' => []]]);

    $response = ($this->get)($kernel);
    $transport = $kernel->getContainer()->get('test.service_container')->get('messenger.transport.async');

    expect($response->getStatusCode())->toBe(200)
        ->and(json_decode((string) $response->getContent(), true)['deploy']['settled'])->toBeFalse()
        ->and($transport->getSent())->toBe([])
        ->and(glob($this->dir.'/store/results-*'))->toBe([]);
});

it('runs the checks against a Doctrine connection and passes', function () {
    $kernel = ($this->kernel)([
        'tier' => 'full',
        'checks' => ['database' => ['expected' => 'sqlite'], 'scheduler' => [], 'scheduler.release' => [], 'storage' => [], 'env' => ['required' => ['APP_SECRET']]],
    ], connection: ['driver' => 'pdo_sqlite', 'memory' => true]);
    ($this->run)($kernel);

    $body = json_decode((string) ($this->get)($kernel)->getContent(), true);

    expect($body['status'])->toBe('pass')
        ->and($body['deploy']['settled'])->toBeTrue()
        ->and($body['deploy']['checks']['database']['status'])->toBe('pass')
        ->and($body['deploy']['checks']['database']['observed'])->toStartWith('sqlite')
        ->and($body['deploy']['checks']['env']['status'])->toBe('pass');
});

it('sends the probe through the transport and passes once a worker answers it', function () {
    $kernel = ($this->kernel)(['tier' => 'full', 'checks' => ['queue' => ['expected' => 'in-memory'], 'queue.release' => [], 'scheduler' => []]]);
    $container = $kernel->getContainer()->get('test.service_container');
    ($this->run)($kernel);

    /** @var InMemoryTransport $transport */
    $transport = $container->get('messenger.transport.async');
    $sent = $transport->getSent();
    expect($sent)->toHaveCount(1)
        ->and($sent[0]->getMessage())->toBeInstanceOf(ProbeMessage::class);

    $before = json_decode((string) ($this->get)($kernel)->getContent(), true);
    expect($before['deploy']['checks']['queue']['status'])->toBe('pending');

    // What `messenger:consume async` does: the worker's handler answers the probe.
    $container->get(ProbeHandler::class)($sent[0]->getMessage());

    $after = json_decode((string) ($this->get)($kernel)->getContent(), true);
    expect($after['deploy']['checks']['queue']['status'])->toBe('pass')
        ->and($after['deploy']['checks']['queue']['observed'])->toBe('in-memory')
        ->and($after['deploy']['checks']['queue.release']['status'])->toBe('pass');
});

it('fails the queue check when the probe transport runs in-process, and skips queue.release', function () {
    $kernel = ($this->kernel)(['tier' => 'full', 'checks' => ['queue' => [], 'queue.release' => [], 'scheduler' => []]], 'sync://');
    ($this->run)($kernel);

    $response = ($this->get)($kernel);
    $body = json_decode((string) $response->getContent(), true);

    expect($response->getStatusCode())->toBe(503)
        ->and($body['deploy']['checks']['queue']['code'])->toBe('queue_driver_mismatch')
        ->and($body['deploy']['checks']['queue']['observed'])->toBe('sync')
        // No probe can say which release a worker runs: skipped, dated to the run.
        ->and($body['deploy']['checks']['queue.release']['status'])->toBe('skip')
        ->and($body['deploy']['checks']['queue.release']['checked_at'])->toBe($body['deploy']['checks']['queue']['checked_at']);
});

it('reports a forced database error as a fixed code with no username, host or DSN', function () {
    $kernel = ($this->kernel)(['tier' => 'full', 'checks' => ['database' => ['expected' => 'postgres'], 'scheduler' => []]], connection: [
        'driver' => 'pdo_pgsql',
        'host' => '127.0.0.1',
        'port' => 1,
        'dbname' => 'leaky_db',
        'user' => 'leaky_user',
        'password' => 'leaky_password',
    ]);
    ($this->run)($kernel);

    $response = ($this->get)($kernel);
    $body = json_decode((string) $response->getContent(), true);

    expect($response->getStatusCode())->toBe(503)
        ->and($body['deploy']['checks']['database']['code'])->toBe('database_unreachable');
    foreach (['leaky_user', 'leaky_password', 'leaky_db', '127.0.0.1', 'pgsql:', 'SQLSTATE', 'refused', $this->dir] as $secret) {
        expect((string) $response->getContent())->not->toContain($secret);
    }
})->skip(! extension_loaded('pdo_pgsql'), 'needs pdo_pgsql');

it('infers the checks from the container when none are declared', function () {
    $kernel = ($this->kernel)(['tier' => 'full'], connection: ['driver' => 'pdo_sqlite', 'memory' => true]);

    $checks = $kernel->getContainer()->get('test.service_container')->getParameter('deploy_report.checks');

    expect(array_keys($checks))->toBe(['database', 'queue', 'queue.release', 'scheduler', 'scheduler.release', 'storage', 'env']);
});

it('names transports by class, never by DSN', function () {
    expect(SymfonyChecks::transportKind(new InMemoryTransport))->toBe('in-memory');
});

/**
 * A DBAL connection to SQLite that records every statement and can refuse
 * temporary tables the way Vitess does (SQLSTATE 0A000).
 *
 * @param list<string> $statements
 */
function recordingConnection(array &$statements, bool $noTemporaryTables): \Doctrine\DBAL\Connection
{
    $configuration = new \Doctrine\DBAL\Configuration();
    $configuration->setMiddlewares([new class($statements, $noTemporaryTables) implements \Doctrine\DBAL\Driver\Middleware {
        public function __construct(private array &$statements, private readonly bool $noTemporaryTables) {}

        public function wrap(\Doctrine\DBAL\Driver $driver): \Doctrine\DBAL\Driver
        {
            $statements = &$this->statements;
            $refuse = $this->noTemporaryTables;

            return new class($driver, $statements, $refuse) extends \Doctrine\DBAL\Driver\Middleware\AbstractDriverMiddleware {
                public function __construct(\Doctrine\DBAL\Driver $driver, private array &$statements, private readonly bool $refuse)
                {
                    parent::__construct($driver);
                }

                public function connect(array $params): \Doctrine\DBAL\Driver\Connection
                {
                    $statements = &$this->statements;

                    return new class(parent::connect($params), $statements, $this->refuse) extends \Doctrine\DBAL\Driver\Middleware\AbstractConnectionMiddleware {
                        public function __construct(\Doctrine\DBAL\Driver\Connection $connection, private array &$statements, private readonly bool $refuse)
                        {
                            parent::__construct($connection);
                        }

                        public function exec(string $sql): int|string
                        {
                            $this->statements[] = $sql;
                            if ($this->refuse && str_starts_with($sql, 'CREATE TEMPORARY')) {
                                $e = new \PDOException('SQLSTATE[0A000]: unsupported for leaky_user@secret-host.internal');
                                $e->errorInfo = ['0A000', 0, 'unsupported for leaky_user@secret-host.internal'];

                                throw \Doctrine\DBAL\Driver\PDO\Exception::new($e);
                            }

                            return parent::exec($sql);
                        }

                        public function prepare(string $sql): \Doctrine\DBAL\Driver\Statement
                        {
                            $this->statements[] = $sql;

                            return parent::prepare($sql);
                        }

                        public function query(string $sql): \Doctrine\DBAL\Driver\Result
                        {
                            $this->statements[] = $sql;

                            return parent::query($sql);
                        }
                    };
                }
            };
        }
    }]);

    return \Doctrine\DBAL\DriverManager::getConnection(['driver' => 'pdo_sqlite', 'memory' => true], $configuration);
}

function symfonyDatabaseCheck(\Doctrine\DBAL\Connection $connection): \DeployDoubles\Checks\CheckResult
{
    $config = new \DeployDoubles\Checks\Config(tempDir(), ['database' => ['expected' => 'sqlite']]);

    return (new SymfonyChecks($config, SF_COMMIT, tempDir(), 'async', $connection, null, null))->database();
}

it('skips the write test with database_write_unsupported when the server has no temporary tables', function () {
    $statements = [];
    $result = symfonyDatabaseCheck(recordingConnection($statements, noTemporaryTables: true));

    expect($result->status->value)->toBe('skip')
        ->and($result->code)->toBe('database_write_unsupported')
        ->and(json_encode($result->toArray()))->not->toContain('leaky_user');
});

it('drops only the temporary probe table after the write test', function () {
    $statements = [];
    $result = symfonyDatabaseCheck(recordingConnection($statements, noTemporaryTables: false));

    expect($result->status->value)->toBe('pass')
        ->and($statements)->toContain('DROP TABLE temp.deploy_report_probe')
        ->and($statements)->not->toContain('DROP TABLE deploy_report_probe');
});
