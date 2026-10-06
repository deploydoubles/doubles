<?php

/*
 * A rollback, or a redeploy of a commit that already ran, brings back a
 * release whose results, probes, heartbeat and boot marker are still in the
 * store. None of that describes the new deployment.
 */

use DeployDoubles\Checks\CheckResult;
use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\FileStore;
use DeployDoubles\Checks\Probes;
use DeployDoubles\Checks\ReportReader;
use DeployDoubles\Checks\Runner;

const RELEASE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RELEASE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** Minute-aligned, so heartbeat minutes are predictable. */
const MINUTE_ZERO = 1_800_000_000 - (1_800_000_000 % 60);

function returningConfig(string $dir): Config
{
    return new Config($dir, ['queue' => ['expected' => 'redis'], 'queue.release' => [], 'scheduler' => [], 'scheduler.release' => []]);
}

/** One scheduled run of $commit; $answeredBy is the commit of the worker that answers the probe at once, or null for no worker. */
function tick(FileStore $store, Config $config, FakeClock $clock, string $commit, ?string $answeredBy): void
{
    (new Runner(
        $store,
        $config,
        $commit,
        ['queue' => fn () => CheckResult::pass('ok', 'redis', 'redis 7.4')],
        $answeredBy === null
            ? static function (string $probe): void {}
        : static fn (string $probe) => Probes::answer($store, $probe, $answeredBy, $clock->now),
        $clock->closure(),
    ))->run();
}

function readAs(FileStore $store, Config $config, FakeClock $clock, string $commit): array
{
    return (new ReportReader($store, $config, $commit, $clock->closure()))->read()->toArray();
}

/** The newest checked_at in a report, as a Unix time. */
function newestCheckedAt(array $report): int
{
    return max(array_map(static fn (array $c) => strtotime($c['checked_at']), $report['deploy']['checks']));
}

it('dates the stale report of a returning release to its last run, not to the request', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = returningConfig($dir);
    $clock = new FakeClock(MINUTE_ZERO);

    foreach (range(1, 3) as $_) {
        tick($store, $config, $clock, RELEASE_A, RELEASE_A);
        $clock->advance(60);
    }
    $lastRunOfA = $clock->now - 60;
    foreach (range(1, 10) as $_) {
        tick($store, $config, $clock, RELEASE_B, RELEASE_B);
        $clock->advance(60);
    }

    // Rolled back to A; read 5 s later, before A's scheduler has run.
    $clock->advance(5);
    $switchedAt = $clock->now;
    $before = readAs($store, $config, $clock, RELEASE_A);

    // The store cannot tell a rollback from a dead scheduler, but the evidence
    // is dated before the switch, so a verifier that first saw A after the
    // switch keeps polling instead of failing a healthy rollback.
    expect($before['deploy']['checks']['scheduler']['code'])->toBe('scheduler_results_stale')
        ->and(newestCheckedAt($before))->toBe($lastRunOfA)
        ->and(newestCheckedAt($before))->toBeLessThan($switchedAt);

    // A's scheduler runs; its worker answers.
    tick($store, $config, $clock, RELEASE_A, RELEASE_A);
    $clock->advance(5);
    $after = readAs($store, $config, $clock, RELEASE_A);

    expect($after['status'])->toBe('pass')
        ->and($after['deploy']['settled'])->toBeTrue()
        ->and(newestCheckedAt($after))->toBeGreaterThanOrEqual($switchedAt);
});

it('does not pass queue.release on a probe answered in an earlier life of the release', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = returningConfig($dir);
    $clock = new FakeClock(MINUTE_ZERO);

    tick($store, $config, $clock, RELEASE_A, RELEASE_A);
    $clock->advance(60);
    tick($store, $config, $clock, RELEASE_A, RELEASE_A);
    $clock->advance(60);
    tick($store, $config, $clock, RELEASE_B, RELEASE_B);
    $clock->advance(50);

    // Rolled back to A within the staleness window. A's scheduler runs; the
    // workers (still on B) have not taken the new probe yet.
    tick($store, $config, $clock, RELEASE_A, null);
    $clock->advance(10);
    $report = readAs($store, $config, $clock, RELEASE_A);

    expect($report['deploy']['checks']['queue.release']['status'])->toBe('pending')
        ->and($report['deploy']['checks']['queue']['status'])->toBe('pending')
        ->and($report['deploy']['settled'])->toBeFalse();
});

it('fails queue.release once the workers still on the other release answer the returning release', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = returningConfig($dir);
    $clock = new FakeClock(MINUTE_ZERO);

    tick($store, $config, $clock, RELEASE_A, RELEASE_A);
    $clock->advance(60);
    tick($store, $config, $clock, RELEASE_B, RELEASE_B);
    $clock->advance(60);
    tick($store, $config, $clock, RELEASE_B, RELEASE_B);
    $clock->advance(10);
    tick($store, $config, $clock, RELEASE_A, RELEASE_B);
    $clock->advance(5);

    expect(readAs($store, $config, $clock, RELEASE_A)['deploy']['checks']['queue.release']['code'])->toBe('queue_release_mismatch');
});

it('treats the minute a returning release takes over in as its takeover minute', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = returningConfig($dir);
    $clock = new FakeClock(MINUTE_ZERO);

    tick($store, $config, $clock, RELEASE_A, RELEASE_A); // minute 0
    $clock->advance(60);
    tick($store, $config, $clock, RELEASE_A, RELEASE_A); // minute 1
    $clock->advance(60);
    tick($store, $config, $clock, RELEASE_B, RELEASE_B); // minute 2
    $clock->advance(60);
    tick($store, $config, $clock, RELEASE_B, RELEASE_B); // minute 3, B's last run
    $clock->advance(5);
    tick($store, $config, $clock, RELEASE_A, RELEASE_A); // minute 3: A is back
    $clock->advance(5);

    expect(readAs($store, $config, $clock, RELEASE_A)['deploy']['checks']['scheduler.release']['status'])->toBe('pass');

    // A real overlap after the return is still caught.
    $clock->advance(50);
    tick($store, $config, $clock, RELEASE_B, RELEASE_B); // minute 4
    tick($store, $config, $clock, RELEASE_A, RELEASE_A); // minute 4
    $clock->advance(5);

    expect(readAs($store, $config, $clock, RELEASE_A)['deploy']['checks']['scheduler.release']['code'])->toBe('scheduler_release_mismatch');
});

it('resets booted_at to when the returning release was first seen running again', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = returningConfig($dir);
    $clock = new FakeClock(MINUTE_ZERO);

    tick($store, $config, $clock, RELEASE_A, RELEASE_A);
    $clock->advance(60);
    tick($store, $config, $clock, RELEASE_B, RELEASE_B);
    $clock->advance(300);
    $returnedAt = $clock->now;
    tick($store, $config, $clock, RELEASE_A, RELEASE_A);
    $clock->advance(5);

    expect(readAs($store, $config, $clock, RELEASE_A)['deploy']['release']['booted_at'])->toBe(gmdate('Y-m-d\TH:i:s\Z', $returnedAt));
});

it('starts a fresh run for a redeploy of the same commit after its results went stale', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = returningConfig($dir);
    $clock = new FakeClock(MINUTE_ZERO);

    tick($store, $config, $clock, RELEASE_A, RELEASE_A);
    $clock->advance(600);
    // Redeployed; this time no worker runs. The old answered probe must not keep queue green.
    tick($store, $config, $clock, RELEASE_A, null);
    $clock->advance(60);
    tick($store, $config, $clock, RELEASE_A, null);
    $clock->advance(65);

    $report = readAs($store, $config, $clock, RELEASE_A);

    expect($report['deploy']['checks']['queue']['code'])->toBe('queue_no_worker')
        ->and($report['deploy']['release']['booted_at'])->toBe(gmdate('Y-m-d\TH:i:s\Z', MINUTE_ZERO + 600));
});

it('keeps the state of a release whose scheduler runs every minute next to another one', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = returningConfig($dir);
    $clock = new FakeClock(MINUTE_ZERO);

    tick($store, $config, $clock, RELEASE_A, RELEASE_A);
    $bootedAt = $clock->now;
    foreach (range(1, 4) as $_) {
        $clock->advance(55);
        tick($store, $config, $clock, RELEASE_B, RELEASE_B);
        $clock->advance(5);
        tick($store, $config, $clock, RELEASE_A, RELEASE_A);
    }
    $clock->advance(5);

    expect(readAs($store, $config, $clock, RELEASE_A)['deploy']['release']['booted_at'])->toBe(gmdate('Y-m-d\TH:i:s\Z', $bootedAt));
});
