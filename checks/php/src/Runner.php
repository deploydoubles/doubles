<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

use Closure;
use Throwable;

/**
 * The scheduled run: executes the declared checks, writes their results and
 * a heartbeat to the store, and dispatches one queue probe. Adapters call it
 * once a minute from the app's own scheduler.
 */
final class Runner
{
    /** Checks whose result is produced by the scheduled run itself. */
    public const RUN_TIME_CHECKS = ['database', 'cache', 'queue', 'storage', 'assets', 'env'];

    private const MINUTES_KEPT = 5;
    private const PROBE_TTL = 900;
    private const OTHER_RELEASE_TTL = 3600;

    /**
     * A release whose last run is older than this (more than one missed
     * minute), while another release started in between, has come back:
     * a rollback or a redeploy of a commit that ran before.
     */
    private const RETURN_GAP = 90;

    /** @var Closure(): int */
    private Closure $clock;

    /**
     * @param array<string, Closure(): CheckResult> $checks run-time check implementations by name
     * @param (Closure(string): void)|null $dispatchProbe dispatches a probe job carrying the probe's store name
     * @param (Closure(string): void)|null $warn receives configuration warnings and the class of a check error (never a message or a secret)
     */
    public function __construct(
        private readonly FileStore $store,
        private readonly Config $config,
        private readonly ?string $commit,
        private readonly array $checks,
        private readonly ?Closure $dispatchProbe = null,
        ?Closure $clock = null,
        private readonly ?Closure $warn = null,
    ) {
        $this->clock = $clock ?? time(...);
    }

    /** @return array<string, CheckResult> */
    public function run(): array
    {
        $now = ($this->clock)();
        $previous = $this->store->read(Store::results($this->commit));
        if ($this->isReturning($previous, $now)) {
            $this->forgetEarlierLife();
            $previous = null;
        }
        $since = is_int($previous['since'] ?? null) ? $previous['since'] : $now;
        $this->store->createIfAbsent(Store::boot($this->commit), ['at' => $now]);

        $warning = (new TierFilter($this->config))->configurationWarning();
        if ($warning !== null && $this->warn !== null) {
            ($this->warn)($warning);
        }

        $results = [];
        foreach (self::RUN_TIME_CHECKS as $name) {
            if (! $this->config->declares($name) && ! ($name === 'queue' && $this->config->declares('queue.release'))) {
                continue;
            }
            $check = $this->checks[$name] ?? null;
            if ($check === null) {
                $results[$name] = new CheckResult(Status::Skip, checkedAt: $now);
                continue;
            }
            try {
                $results[$name] = $check()->withCheckedAt($now);
            } catch (Throwable $e) {
                $results[$name] = CheckResult::fail(ErrorMapper::map($name, $e), checkedAt: $now);
                $this->reportError($name, $e);
            }
        }

        if (isset($results['queue']) && $results['queue']->status !== Status::Fail && $this->dispatchProbe !== null) {
            $id = Probes::newId();
            try {
                Probes::record($this->store, $this->commit, $id, $now);
                ($this->dispatchProbe)(Store::probe($this->commit, $id));
            } catch (Throwable $e) {
                $this->store->delete(Store::probe($this->commit, $id));
                $results['queue'] = CheckResult::fail(Codes::QUEUE_ERROR, 'the probe job could not be dispatched', $results['queue']->expected, $results['queue']->observed, $now);
                $this->reportError('queue', $e);
            }
        }

        $this->store->write(Store::results($this->commit), [
            'commit' => Store::key($this->commit),
            'since' => $since,
            'ran_at' => $now,
            'checks' => array_map(static fn (CheckResult $r) => $r->toStore(), $results),
        ]);

        $this->heartbeat($now);
        $this->prune($now);

        return $results;
    }

    /**
     * Whether the stored state for this commit belongs to an earlier life of
     * the release: a rollback to it, or a redeploy of it. Its results, probes,
     * heartbeat and boot marker then describe a different deployment and must
     * not be read as this one's.
     *
     * @param array<string, mixed>|null $results this commit's stored results
     */
    private function isReturning(?array $results, int $now): bool
    {
        if ($results !== null) {
            $ranAt = is_int($results['ran_at'] ?? null) ? $results['ran_at'] : 0;
            if ($now - $ranAt > ReportReader::STALE_AFTER) {
                return true;
            }
            if ($now - $ranAt <= self::RETURN_GAP) {
                return false;
            }
            // Another release started after this one last ran: it was replaced, and is back.
            $own = Store::results($this->commit);
            foreach ($this->store->names('results-') as $name) {
                if ($name === $own) {
                    continue;
                }
                $other = $this->store->read($name);
                if (is_int($other['since'] ?? null) && $other['since'] > $ranAt) {
                    return true;
                }
            }

            return false;
        }

        // No results, but state left over from an earlier life of this commit.
        if ($this->store->read(Store::heartbeat($this->commit)) !== null
            || $this->store->names(Store::probePrefix($this->commit)) !== []) {
            return true;
        }
        $boot = $this->store->read(Store::boot($this->commit));

        return is_int($boot['at'] ?? null) && $now - $boot['at'] > ReportReader::STALE_AFTER;
    }

    /** Clears this commit's heartbeat (and with it the takeover minute), probes and boot marker. */
    private function forgetEarlierLife(): void
    {
        $this->store->delete(Store::heartbeat($this->commit));
        $this->store->delete(Store::boot($this->commit));
        foreach ($this->store->names(Store::probePrefix($this->commit)) as $name) {
            $this->store->delete($name);
        }
    }

    /** Hands the error's class — never its message — to the warn hook, so "check the app's logs" is true. */
    private function reportError(string $check, Throwable $e): void
    {
        if ($this->warn !== null) {
            ($this->warn)(sprintf('deploy-report: the %s check failed with %s.', $check, $e::class));
        }
    }

    private function heartbeat(int $now): void
    {
        $name = Store::heartbeat($this->commit);
        $previous = $this->store->read($name) ?? [];
        $minute = intdiv($now, 60);

        $minutes = is_array($previous['minutes'] ?? null) ? array_filter($previous['minutes'], 'is_int') : [];
        $minutes[] = $minute;
        $minutes = array_values(array_slice(array_unique($minutes), -self::MINUTES_KEPT));

        $this->store->write($name, [
            'commit' => Store::key($this->commit),
            'at' => $now,
            'first_minute' => is_int($previous['first_minute'] ?? null) ? $previous['first_minute'] : $minute,
            'minutes' => $minutes,
        ]);
    }

    private function prune(int $now): void
    {
        $key = Store::key($this->commit);

        foreach ($this->store->names('probe-') as $name) {
            $probe = $this->store->read($name);
            if (! is_int($probe['dispatched_at'] ?? null) || $now - $probe['dispatched_at'] > self::PROBE_TTL) {
                $this->store->delete($name);
            }
        }

        foreach (['results-' => 'ran_at', 'heartbeat-' => 'at', 'boot-' => 'at'] as $prefix => $field) {
            foreach ($this->store->names($prefix) as $name) {
                if ($name === $prefix.$key) {
                    continue;
                }
                $data = $this->store->read($name);
                if (! is_int($data[$field] ?? null) || $now - $data[$field] > self::OTHER_RELEASE_TTL) {
                    $this->store->delete($name);
                }
            }
        }
    }
}
