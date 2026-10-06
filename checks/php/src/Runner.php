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

    /** @var Closure(): int */
    private Closure $clock;

    /**
     * @param array<string, Closure(): CheckResult> $checks run-time check implementations by name
     * @param (Closure(string): void)|null $dispatchProbe dispatches a probe job carrying the probe's store name
     * @param (Closure(string): void)|null $warn receives configuration warnings (never secrets)
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
            }
        }

        $this->store->write(Store::results($this->commit), [
            'commit' => Store::key($this->commit),
            'ran_at' => $now,
            'checks' => array_map(static fn (CheckResult $r) => $r->toStore(), $results),
        ]);

        $this->heartbeat($now);
        $this->prune($now);

        return $results;
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
