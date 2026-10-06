<?php

use DeployDoubles\Checks\CheckResult;
use DeployDoubles\Checks\Config;
use DeployDoubles\Checks\FileStore;
use DeployDoubles\Checks\Probes;
use DeployDoubles\Checks\ReportReader;
use DeployDoubles\Checks\Runner;
use DeployDoubles\Checks\Store;

const COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_COMMIT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function readerConfig(string $dir): Config
{
    return new Config($dir, [
        'database' => ['expected' => 'mysql'],
        'queue' => ['expected' => 'redis'],
        'queue.release' => [],
        'scheduler' => [],
        'scheduler.release' => [],
    ]);
}

/** Runs the scheduled checks with passing stubs; probes are recorded but answered only when $answer says so. */
function runOnce(FileStore $store, Config $config, FakeClock $clock, ?Closure $onProbe = null, string $commit = COMMIT): void
{
    (new Runner(
        $store,
        $config,
        $commit,
        [
            'database' => fn () => CheckResult::pass('ok', 'mysql', 'mysql 8.4'),
            'queue' => fn () => CheckResult::pass('ok', 'redis', 'redis 7.4'),
        ],
        $onProbe ?? static function (string $probe): void {},
        $clock->closure(),
    ))->run();
}

function readReport(FileStore $store, Config $config, FakeClock $clock, string $commit = COMMIT): array
{
    return (new ReportReader($store, $config, $commit, $clock->closure()))->read()->toArray();
}

it('reports only scheduler fail when stored results are older than 180 s', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = readerConfig($dir);
    $clock = new FakeClock();

    runOnce($store, $config, $clock, fn (string $p) => Probes::answer($store, $p, COMMIT, $clock->now));
    $clock->advance(181);
    $report = readReport($store, $config, $clock);

    expect(array_keys($report['deploy']['checks']))->toBe(['scheduler'])
        ->and($report['deploy']['checks']['scheduler']['status'])->toBe('fail')
        ->and($report['deploy']['checks']['scheduler']['code'])->toBe('scheduler_results_stale')
        ->and($report['status'])->toBe('fail')
        ->and($report['deploy']['settled'])->toBeTrue();
});

it('keeps results that are exactly 180 s old', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = readerConfig($dir);
    $clock = new FakeClock();

    runOnce($store, $config, $clock, fn (string $p) => Probes::answer($store, $p, COMMIT, $clock->now));
    $clock->advance(ReportReader::STALE_AFTER);

    expect(readReport($store, $config, $clock)['deploy']['checks'])->toHaveKeys(['database', 'queue']);

    $clock->advance(1);

    expect(array_keys(readReport($store, $config, $clock)['deploy']['checks']))->toBe(['scheduler']);
});

it('is pending before the first scheduled run and fails once 120 s pass without a heartbeat', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = readerConfig($dir);
    $clock = new FakeClock();

    $first = readReport($store, $config, $clock);
    expect($first['deploy']['settled'])->toBeFalse()
        ->and($first['status'])->toBe('warn')
        ->and(array_unique(array_column($first['deploy']['checks'], 'status')))->toBe(['pending']);

    $clock->advance(121);
    $later = readReport($store, $config, $clock);

    expect(array_keys($later['deploy']['checks']))->toBe(['scheduler'])
        ->and($later['deploy']['checks']['scheduler']['code'])->toBe('scheduler_not_running');
});

it('passes queue and queue.release when the worker on this release answers', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = readerConfig($dir);
    $clock = new FakeClock();

    runOnce($store, $config, $clock, fn (string $p) => Probes::answer($store, $p, COMMIT, $clock->now + 1));
    $report = readReport($store, $config, $clock);

    expect($report['deploy']['checks']['queue']['status'])->toBe('pass')
        ->and($report['deploy']['checks']['queue.release']['status'])->toBe('pass')
        ->and($report['status'])->toBe('pass')
        ->and($report['deploy']['settled'])->toBeTrue();
});

it('fails queue.release when the worker runs another commit', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = readerConfig($dir);
    $clock = new FakeClock();

    runOnce($store, $config, $clock, fn (string $p) => Probes::answer($store, $p, OTHER_COMMIT, $clock->now));
    $report = readReport($store, $config, $clock);

    expect($report['deploy']['checks']['queue']['status'])->toBe('pass')
        ->and($report['deploy']['checks']['queue.release']['status'])->toBe('fail')
        ->and($report['deploy']['checks']['queue.release']['code'])->toBe('queue_release_mismatch');
});

it('keeps queue pending while the oldest unanswered probe is younger than 120 s', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = readerConfig($dir);
    $clock = new FakeClock();

    runOnce($store, $config, $clock);
    $clock->advance(60);
    runOnce($store, $config, $clock);
    $report = readReport($store, $config, $clock);

    expect($report['deploy']['checks']['queue']['status'])->toBe('pending')
        ->and($report['deploy']['checks']['queue']['retry_after'])->toBeGreaterThan(0)
        ->and($report['deploy']['settled'])->toBeFalse();
});

it('fails queue against the oldest unanswered probe even while fresh probes keep arriving', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = readerConfig($dir);
    $clock = new FakeClock();

    foreach (range(1, 3) as $minute) {
        runOnce($store, $config, $clock);
        $clock->advance(60);
    }
    // The newest probe is 60 s old; the oldest is 180 s old.
    $report = readReport($store, $config, $clock);

    expect($report['deploy']['checks']['queue']['status'])->toBe('fail')
        ->and($report['deploy']['checks']['queue']['code'])->toBe('queue_no_worker')
        ->and($report['deploy']['checks']['queue.release']['status'])->toBe('fail')
        ->and($report['deploy']['settled'])->toBeTrue();
});

it('does not fail the queue on one lost probe while later probes are answered', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = readerConfig($dir);
    $clock = new FakeClock();

    runOnce($store, $config, $clock); // this probe is lost: the job failed or was dropped
    $clock->advance(60);
    foreach (range(1, 4) as $minute) {
        runOnce($store, $config, $clock, fn (string $p) => Probes::answer($store, $p, COMMIT, $clock->now));
        $clock->advance(60);
    }

    expect(readReport($store, $config, $clock)['deploy']['checks']['queue']['status'])->toBe('pass');
});

it('still fails the queue when probes dispatched after the last answered one wait too long', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = readerConfig($dir);
    $clock = new FakeClock();

    runOnce($store, $config, $clock, fn (string $p) => Probes::answer($store, $p, COMMIT, $clock->now));
    $clock->advance(60);
    // The worker dies.
    foreach (range(1, 3) as $minute) {
        runOnce($store, $config, $clock);
        $clock->advance(60);
    }

    expect(readReport($store, $config, $clock)['deploy']['checks']['queue']['code'])->toBe('queue_no_worker');
});

it('creates the boot marker without hard links, once', function () {
    $dir = tempDir();
    $store = new FileStore($dir, static fn (string $target, string $path): bool => false);
    $config = readerConfig($dir);
    $clock = new FakeClock();

    $first = readReport($store, $config, $clock);
    $clock->advance(30);
    $second = readReport($store, $config, $clock);

    expect($store->read(Store::boot(COMMIT)))->toBe(['at' => 1_800_000_000])
        ->and($first['deploy']['release']['booted_at'])->toBe(gmdate('Y-m-d\TH:i:s\Z', 1_800_000_000))
        ->and($second['deploy']['release']['booted_at'])->toBe(gmdate('Y-m-d\TH:i:s\Z', 1_800_000_000))
        ->and(glob($dir.'/*'))->toBe([$dir.'/boot-'.COMMIT.'.json']);

    $clock->advance(100);
    expect(readReport($store, $config, $clock)['deploy']['checks']['scheduler']['code'])->toBe('scheduler_not_running');
});

it('fails with a fixed code instead of staying pending when no boot marker can be stored', function () {
    $file = tempnam(sys_get_temp_dir(), 'dd-file');
    $store = new FileStore($file.'/store'); // a directory below a regular file can never be created
    $config = readerConfig($file);
    $clock = new FakeClock();

    // The store suppresses the filesystem warning with @; PHPUnit records suppressed warnings anyway.
    set_error_handler(static fn (): bool => true);
    try {
        $report = readReport($store, $config, $clock);
    } finally {
        restore_error_handler();
    }

    expect(array_keys($report['deploy']['checks']))->toBe(['scheduler'])
        ->and($report['deploy']['checks']['scheduler']['status'])->toBe('fail')
        ->and($report['deploy']['checks']['scheduler']['code'])->toBe('report_store_unwritable')
        ->and($report['deploy']['settled'])->toBeTrue()
        ->and($report['status'])->toBe('fail');
});

it('hands the error class, never its message, to the warn hook when a check throws', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = readerConfig($dir);
    $warnings = [];

    (new Runner(
        $store,
        $config,
        COMMIT,
        ['database' => fn () => throw new \PDOException('SQLSTATE[HY000] [2002] secret-host.internal refused leaky_user')],
        warn: function (string $message) use (&$warnings): void {
            $warnings[] = $message;
        },
    ))->run();

    expect($warnings)->toHaveCount(1)
        ->and($warnings[0])->toContain('database')
        ->and($warnings[0])->toContain('PDOException')
        ->and($warnings[0])->not->toContain('secret-host')
        ->and($warnings[0])->not->toContain('leaky_user')
        ->and($warnings[0])->not->toContain('SQLSTATE');
});

it('fails scheduler.release when two releases run the scheduler in the same minute', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = readerConfig($dir);
    $clock = new FakeClock(1_800_000_000 - (1_800_000_000 % 60));
    $answer = fn (string $p) => Probes::answer($store, $p, COMMIT, $clock->now);

    foreach (range(1, 3) as $minute) {
        runOnce($store, $config, $clock, $answer);
        runOnce($store, $config, $clock, null, OTHER_COMMIT);
        $clock->advance(60);
    }
    $clock->advance(-50);
    $report = readReport($store, $config, $clock);

    expect($report['deploy']['checks']['scheduler.release']['status'])->toBe('fail')
        ->and($report['deploy']['checks']['scheduler.release']['code'])->toBe('scheduler_release_mismatch');
});

it('passes scheduler.release after a clean switch from the previous release', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $config = readerConfig($dir);
    $clock = new FakeClock(1_800_000_000 - (1_800_000_000 % 60));
    $answer = fn (string $p) => Probes::answer($store, $p, COMMIT, $clock->now);

    runOnce($store, $config, $clock, null, OTHER_COMMIT);
    $clock->advance(60);
    runOnce($store, $config, $clock, null, OTHER_COMMIT);
    // the switch happens; the old release ran once more in the takeover minute
    runOnce($store, $config, $clock, $answer);
    $clock->advance(60);
    runOnce($store, $config, $clock, $answer);
    $clock->advance(10);

    expect(readReport($store, $config, $clock)['deploy']['checks']['scheduler.release']['status'])->toBe('pass');
});

it('never reads a check or touches anything but the store while reading', function () {
    $source = file_get_contents(__DIR__.'/../../src/ReportReader.php');

    expect($source)->not->toContain('getMessage')
        ->and($source)->not->toContain('dispatch(')
        ->and($source)->not->toContain('PDO');
});

it('writes results atomically through a temporary file', function () {
    $dir = tempDir();
    $store = new FileStore($dir);
    $store->write('results-x', ['ran_at' => 1]);

    expect(glob($dir.'/*.tmp'))->toBe([])
        ->and($store->read('results-x'))->toBe(['ran_at' => 1]);
});
