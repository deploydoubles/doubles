<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

/**
 * Queue probes: recorded when dispatched by the scheduled run, answered by
 * the worker that processes the probe job.
 */
final class Probes
{
    public static function newId(): string
    {
        return bin2hex(random_bytes(8));
    }

    public static function record(FileStore $store, ?string $commit, string $id, int $now): void
    {
        $store->write(Store::probe($commit, $id), [
            'id' => $id,
            'commit' => Store::key($commit),
            'dispatched_at' => $now,
        ]);
    }

    /**
     * Called by the worker. $probeName is the store name the job carries;
     * $workerCommit is resolved by the worker at handle time.
     */
    public static function answer(FileStore $store, string $probeName, ?string $workerCommit, int $now): void
    {
        if (! preg_match('/^probe-[a-z0-9]+-[0-9a-f]{16}$/', $probeName)) {
            return;
        }
        $probe = $store->read($probeName);
        if ($probe === null || isset($probe['answered_at'])) {
            return;
        }
        $probe['answered_at'] = $now;
        $probe['worker_commit'] = Store::key($workerCommit);
        $store->write($probeName, $probe);
    }
}
