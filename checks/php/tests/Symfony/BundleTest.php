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

it('rejects an environment variable as the tier', function () {
    $_SERVER['DEPLOY_REPORT_TIER'] = 'full';
    ($this->kernel)(['tier' => '%env(DEPLOY_REPORT_TIER)%']);
})->throws(InvalidArgumentException::class, 'environment variables are not accepted');

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

it('fails the queue check when the probe transport runs in-process', function () {
    $kernel = ($this->kernel)(['tier' => 'full', 'checks' => ['queue' => [], 'queue.release' => [], 'scheduler' => []]], 'sync://');
    ($this->run)($kernel);

    $response = ($this->get)($kernel);
    $body = json_decode((string) $response->getContent(), true);

    expect($response->getStatusCode())->toBe(503)
        ->and($body['deploy']['checks']['queue']['code'])->toBe('queue_driver_mismatch')
        ->and($body['deploy']['checks']['queue']['observed'])->toBe('sync');
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
