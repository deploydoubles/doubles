<?php

use DeployDoubles\Checks\Checks\Engines;

/** A PDO that reports a fixed driver and server banner, so the banner-to-engine path runs for real. */
function bannerPdo(string $driver, string $banner): PDO
{
    return new class ($driver, $banner) extends PDO {
        public function __construct(private string $driver, private string $banner)
        {
        }

        public function getAttribute(int $attribute): mixed
        {
            return match ($attribute) {
                PDO::ATTR_DRIVER_NAME => $this->driver,
                PDO::ATTR_SERVER_VERSION => $this->banner,
                default => null,
            };
        }
    };
}

it('accepts a MariaDB server where mysql is expected, as the database check reads it', function (): void {
    // The `mysql` PDO driver connects to MariaDB too, and a framework's configuration
    // cannot say which one it will meet (ST-2706: a Laravel double declaring `mysql`
    // on a MariaDB 11.4 server failed with database_engine_mismatch).
    $observed = Engines::fromPdo(bannerPdo('mysql', '11.4.13-MariaDB-log'));

    expect($observed)->toBe('mariadb 11.4')
        ->and(Engines::satisfies('mysql', Engines::engine($observed)))->toBeTrue()
        ->and(Engines::satisfies('mariadb', 'mysql'))->toBeTrue();
});

it('still holds redis and valkey interchangeable', function (): void {
    expect(Engines::satisfies('redis', 'valkey'))->toBeTrue()
        ->and(Engines::satisfies('valkey', 'redis'))->toBeTrue();
});

it('does not let an allowance cross engine families', function (string $expected, string $observed): void {
    expect(Engines::satisfies($expected, $observed))->toBeFalse();
})->with([
    'mysql vs postgres' => ['mysql', 'postgres'],
    'mariadb vs sqlite' => ['mariadb', 'sqlite'],
    'postgres vs mariadb' => ['postgres', 'mariadb'],
    'mysql vs redis' => ['mysql', 'redis'],
    'redis vs mariadb' => ['redis', 'mariadb'],
]);
