<?php

use DeployDoubles\Checks\CheckResult;
use DeployDoubles\Checks\Codes;
use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\ErrorMapper;
use DeployDoubles\Checks\FileStore;
use DeployDoubles\Checks\ReportReader;
use DeployDoubles\Checks\Runner;
use DeployDoubles\Checks\TierFilter;
use DeployDoubles\Checks\Tier;
use Illuminate\Database\QueryException;

const SECRETS = ['leaky_user', 'leaky_password', 'leaky_db', 'db.internal.example', '10.1.2.3', 'mysql:host', '/var/www', 'SQLSTATE'];

function pdoError(string $sqlState, int $driverCode, string $message): PDOException
{
    $e = new PDOException($message);
    $e->errorInfo = [$sqlState, $driverCode, $message];

    return $e;
}

function leakyQueryException(PDOException $previous): QueryException
{
    return new QueryException('mysql', 'select 1 /* mysql:host=db.internal.example;dbname=leaky_db */', [], $previous);
}

it('maps database errors by SQLSTATE and driver code only', function (PDOException $error, string $code) {
    expect(ErrorMapper::map('database', leakyQueryException($error)))->toBe($code);
})->with([
    'refused' => [fn () => pdoError('HY000', 2002, "SQLSTATE[HY000] [2002] Connection refused (db.internal.example:3306) /var/www"), Codes::DATABASE_UNREACHABLE],
    'auth' => [fn () => pdoError('28000', 1045, "Access denied for user 'leaky_user'@'10.1.2.3' (using password: YES) leaky_password"), Codes::DATABASE_AUTH_FAILED],
    'unknown db' => [fn () => pdoError('42000', 1049, "Unknown database 'leaky_db'"), Codes::DATABASE_MISSING],
    'pg missing db' => [fn () => pdoError('3D000', 7, 'FATAL: database "leaky_db" does not exist'), Codes::DATABASE_MISSING],
    'pg auth' => [fn () => pdoError('28P01', 7, 'password authentication failed for user "leaky_user"'), Codes::DATABASE_AUTH_FAILED],
    'other' => [fn () => pdoError('HY000', 9999, 'something about leaky_user'), Codes::DATABASE_ERROR],
]);

it('puts no error text, user, host, password, path or DSN into the full-tier report', function () {
    $dir = tempDir();
    $config = new Config($dir, ['database' => ['expected' => 'mysql'], 'scheduler' => []], tier: 'full');
    $store = new FileStore($dir);
    $error = leakyQueryException(pdoError('28000', 1045, "SQLSTATE[28000] [1045] Access denied for user 'leaky_user'@'10.1.2.3' leaky_password mysql:host=db.internal.example;dbname=leaky_db /var/www"));

    (new Runner($store, $config, str_repeat('a', 40), [
        'database' => fn (): CheckResult => throw $error,
    ]))->run();

    $report = (new ReportReader($store, $config, str_repeat('a', 40)))->read();
    $body = json_encode((new TierFilter($config))->apply($report->toArray(), Tier::Full, null));

    expect($report->toArray()['deploy']['checks']['database']['code'])->toBe(Codes::DATABASE_AUTH_FAILED);
    foreach (SECRETS as $secret) {
        expect($body)->not->toContain($secret);
    }
});

it('reads no exception message anywhere in the library', function () {
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(__DIR__.'/../../src'));
    foreach ($files as $file) {
        if ($file->isFile() && str_ends_with($file->getFilename(), '.php')) {
            expect(file_get_contents($file->getPathname()))->not->toContain('getMessage', $file->getFilename());
        }
    }
});

it('compares tokens only with hash_equals', function () {
    $source = file_get_contents(__DIR__.'/../../src/TierFilter.php');

    expect($source)->toContain('hash_equals(')
        ->and($source)->not->toMatch('/\$(configured|presented|token)\s*===?\s*\$/')
        ->and($source)->not->toContain('$_GET')
        ->and($source)->not->toContain('?token=');
});
