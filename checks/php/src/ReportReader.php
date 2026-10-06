<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

use Closure;

/**
 * Builds the full report from the result store. It only reads: it never runs
 * a check, dispatches a job or touches a backing service. The one write it
 * may make is the release's boot marker, once, when the store has none.
 *
 * Every `checked_at` is the time of the evidence a result rests on — when the
 * scheduled run produced it, or when the record it was derived from was
 * written — never the time of the request. A verifier can therefore tell a
 * result produced by this deployment from one left by an earlier life of the
 * same commit (a rollback or a redeploy) that the scheduler has not yet
 * replaced.
 */
final class ReportReader
{
    /** Results older than this mean the scheduler stopped: report only `scheduler: fail`. */
    public const STALE_AFTER = 180;

    /** No heartbeat for this long (from boot when there never was one) means no scheduler. */
    public const SCHEDULER_GRACE = 120;

    /** The oldest unanswered probe may wait this long before `queue` fails. */
    public const QUEUE_GRACE = 120;

    /** @var Closure(): int */
    private Closure $clock;

    public function __construct(
        private readonly FileStore $store,
        private readonly Config $config,
        private readonly ?string $commit,
        ?Closure $clock = null,
    ) {
        $this->clock = $clock ?? time(...);
    }

    public function read(): Report
    {
        $now = ($this->clock)();
        $results = $this->store->read(Store::results($this->commit));

        if ($results !== null && $now - (int) ($results['ran_at'] ?? 0) > self::STALE_AFTER) {
            $ranAt = (int) ($results['ran_at'] ?? 0);

            return $this->build(['scheduler' => CheckResult::fail(
                Codes::SCHEDULER_RESULTS_STALE,
                'last scheduled run '.($now - $ranAt).' s ago',
                checkedAt: $ranAt,
            )], $now);
        }

        if ($results === null) {
            return $this->beforeFirstRun($now);
        }

        $stored = is_array($results['checks'] ?? null) ? $results['checks'] : [];
        $checks = [];

        foreach (array_keys($this->config->checks) as $name) {
            $checks[$name] = match ($name) {
                'queue', 'queue.release' => null, // evaluated together below
                'scheduler' => $this->scheduler($now, (int) ($results['ran_at'] ?? $now)),
                'scheduler.release' => $this->schedulerRelease($now),
                default => isset($stored[$name]) && is_array($stored[$name])
                    ? CheckResult::fromStore($stored[$name])
                    : CheckResult::pending(30, 'waiting for the next scheduled run', $now),
            };
        }

        if ($this->config->declares('queue') || $this->config->declares('queue.release')) {
            $configResult = isset($stored['queue']) && is_array($stored['queue']) ? CheckResult::fromStore($stored['queue']) : null;
            [$queue, $release] = $this->queue($configResult, $now);
            if ($this->config->declares('queue')) {
                $checks['queue'] = $queue;
            }
            if ($this->config->declares('queue.release')) {
                $checks['queue.release'] = $release;
            }
        }

        return $this->build($checks, $now);
    }

    private function beforeFirstRun(int $now): Report
    {
        $boot = $this->bootedAt($now);
        if ($boot === null) {
            // Without a boot marker the scheduler's grace has no start, and a
            // report that stayed pending would hide a dead scheduler forever.
            return $this->build(['scheduler' => CheckResult::fail(
                Codes::REPORT_STORE_UNWRITABLE,
                'the result store could not be written',
                checkedAt: $now,
            )], $now);
        }
        $age = $now - $boot;

        if ($age > self::SCHEDULER_GRACE) {
            return $this->build(['scheduler' => CheckResult::fail(
                Codes::SCHEDULER_NOT_RUNNING,
                'no scheduled run for this release in '.$age.' s',
                checkedAt: $now,
            )], $now);
        }

        $retry = max(5, min(30, self::SCHEDULER_GRACE - $age));
        $checks = [];
        foreach (array_keys($this->config->checks) as $name) {
            $checks[$name] = CheckResult::pending($retry, 'waiting for the first scheduled run', $now);
        }
        if ($checks === []) {
            $checks['scheduler'] = CheckResult::pending($retry, 'waiting for the first scheduled run', $now);
        }

        return $this->build($checks, $now);
    }

    private function scheduler(int $now, int $ranAt): CheckResult
    {
        $heartbeat = $this->store->read(Store::heartbeat($this->commit));
        $at = is_int($heartbeat['at'] ?? null) ? $heartbeat['at'] : null;

        if ($at === null) {
            return CheckResult::fail(Codes::SCHEDULER_NOT_RUNNING, 'no heartbeat from this release', checkedAt: $ranAt);
        }
        $age = max(0, $now - $at);
        if ($age > self::SCHEDULER_GRACE) {
            return CheckResult::fail(Codes::SCHEDULER_NOT_RUNNING, 'last heartbeat '.$age.' s ago', checkedAt: $at);
        }

        return CheckResult::pass('last heartbeat '.$age.' s ago', checkedAt: $at);
    }

    private function schedulerRelease(int $now): CheckResult
    {
        $own = $this->store->read(Store::heartbeat($this->commit));
        if ($own === null) {
            return CheckResult::pending(30, 'waiting for the first heartbeat', $now);
        }
        $at = is_int($own['at'] ?? null) ? $own['at'] : $now;

        $first = is_int($own['first_minute'] ?? null) ? $own['first_minute'] : null;
        // The minute this release took over may legitimately contain the
        // previous release's last run; only later minutes count.
        $mine = array_values(array_filter(
            is_array($own['minutes'] ?? null) ? $own['minutes'] : [],
            static fn ($m) => is_int($m) && $m !== $first,
        ));

        $ownName = Store::heartbeat($this->commit);
        foreach ($this->store->names('heartbeat-') as $name) {
            if ($name === $ownName) {
                continue;
            }
            $other = $this->store->read($name);
            $theirs = is_array($other['minutes'] ?? null) ? $other['minutes'] : [];
            if (array_intersect($mine, $theirs) !== []) {
                return CheckResult::fail(
                    Codes::SCHEDULER_RELEASE_MISMATCH,
                    'heartbeats from more than one commit in the same minute',
                    checkedAt: $at,
                );
            }
        }

        return CheckResult::pass('heartbeats in each minute come from one commit', checkedAt: $at);
    }

    /**
     * `queue` and `queue.release`, judged against this release's probes.
     *
     * Only probes dispatched after the newest answered probe count as
     * outstanding: a worker that answered a later probe is alive, so one probe
     * lost on the way (a failed or dropped job) does not fail the queue.
     *
     * @return array{0: CheckResult, 1: CheckResult}
     */
    private function queue(?CheckResult $config, int $now): array
    {
        $expected = $config?->expected;
        $observed = $config?->observed;

        if ($config !== null && $config->status === Status::Fail) {
            // The queue check itself failed (wrong backend, no dispatch): no
            // probe can say which release a worker runs, so the release is skipped.
            $at = $config->checkedAt ?? $now;

            return [$config->withCheckedAt($at), new CheckResult(Status::Skip, checkedAt: $at)];
        }

        $probes = [];
        $answered = null;
        foreach ($this->store->names(Store::probePrefix($this->commit)) as $name) {
            $probe = $this->store->read($name);
            if ($probe === null || ! is_int($probe['dispatched_at'] ?? null)) {
                continue;
            }
            $probes[] = $probe;
            if (is_int($probe['answered_at'] ?? null)
                && ($answered === null
                    || $probe['dispatched_at'] > $answered['dispatched_at']
                    || ($probe['dispatched_at'] === $answered['dispatched_at'] && $probe['answered_at'] > $answered['answered_at']))) {
                $answered = $probe;
            }
        }

        $outstanding = [];
        foreach ($probes as $probe) {
            if (! is_int($probe['answered_at'] ?? null) && ($answered === null || $probe['dispatched_at'] > $answered['dispatched_at'])) {
                $outstanding[] = $probe['dispatched_at'];
            }
        }

        $oldest = $outstanding === [] ? null : min($outstanding);
        $oldestAge = $oldest === null ? null : $now - $oldest;

        if ($oldest !== null && $oldestAge > self::QUEUE_GRACE) {
            $detail = 'oldest unanswered probe has waited '.$oldestAge.' s';

            return [
                CheckResult::fail(Codes::QUEUE_NO_WORKER, $detail, $expected, $observed, $oldest),
                CheckResult::fail(Codes::QUEUE_NO_WORKER, $detail, checkedAt: $oldest),
            ];
        }

        if ($answered === null) {
            $retry = $oldestAge === null ? 30 : max(5, min(30, self::QUEUE_GRACE - $oldestAge));
            $pending = CheckResult::pending($retry, 'waiting for the first probe to be processed', $now);

            return [$pending->withExpectation($expected, $observed), $pending];
        }

        $at = $answered['answered_at'];
        $queue = CheckResult::pass(
            'latest probe answered after '.max(0, $at - $answered['dispatched_at']).' s',
            $expected,
            $observed,
            $at,
        );

        $release = ($answered['worker_commit'] ?? null) === Store::key($this->commit) && $this->commit !== null
            ? CheckResult::pass('the worker runs this release', checkedAt: $at)
            : CheckResult::fail(Codes::QUEUE_RELEASE_MISMATCH, 'the worker that answered the latest probe runs a different commit', checkedAt: $at);

        return [$queue, $release];
    }

    /** When this release was first seen running; null when no marker could be stored. */
    private function bootedAt(int $now): ?int
    {
        $boot = $this->store->createIfAbsent(Store::boot($this->commit), ['at' => $now]);
        if ($boot === null) {
            return null;
        }

        return is_int($boot['at'] ?? null) ? $boot['at'] : $now;
    }

    /** @param array<string, CheckResult|null> $checks */
    private function build(array $checks, int $now): Report
    {
        $checks = array_filter($checks);
        $settled = true;
        $out = [];
        foreach ($checks as $name => $check) {
            if ($check->status === Status::Pending) {
                $settled = false;
            }
            $out[$name] = $check->toArray();
        }

        $boot = $this->store->read(Store::boot($this->commit));

        return new Report([
            'status' => Report::overallStatus($checks)->value,
            'deploy' => [
                'spec_version' => Report::SPEC_VERSION,
                'tier' => Tier::Full->value,
                'settled' => $settled,
                'checks' => $out === [] ? new \stdClass() : $out,
                'app' => $this->app(),
                'release' => [
                    'commit' => $this->commit,
                    'booted_at' => is_int($boot['at'] ?? null) ? gmdate('Y-m-d\TH:i:s\Z', $boot['at']) : null,
                    'run_id_match' => null,
                ],
            ],
        ]);
    }

    /** @return array<string, string>|\stdClass */
    private function app(): array|\stdClass
    {
        $app = [];
        if ($this->config->appName !== null && preg_match('/^[A-Za-z0-9 ._-]{1,64}$/', $this->config->appName)) {
            $app['name'] = $this->config->appName;
        }
        if ($this->config->framework !== null && preg_match('/^[a-z0-9-]+( [0-9]+\.[0-9]+)?$/', $this->config->framework)) {
            $app['framework'] = $this->config->framework;
        }
        $app['runtime'] = 'php '.PHP_MAJOR_VERSION.'.'.PHP_MINOR_VERSION;
        if ($this->config->double !== null && preg_match('/^[a-z0-9]+(-[a-z0-9]+)*$/', $this->config->double)) {
            $app['double'] = $this->config->double;
        }

        return $app;
    }
}
