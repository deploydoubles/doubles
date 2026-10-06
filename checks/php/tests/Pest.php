<?php

use DeployDoubles\Checks\Tests\LaravelTestCase;

pest()->extend(LaravelTestCase::class)->in('Laravel');

function tempDir(): string
{
    $dir = sys_get_temp_dir().'/dd-checks-'.bin2hex(random_bytes(6));
    mkdir($dir, 0777, true);

    return $dir;
}

/** A clock the test can move. */
final class FakeClock
{
    public function __construct(public int $now = 1_800_000_000)
    {
    }

    public function advance(int $seconds): void
    {
        $this->now += $seconds;
    }

    public function closure(): Closure
    {
        return fn (): int => $this->now;
    }
}
