<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Laravel;

use DeployDoubles\Checks\CommitResolver;
use DeployDoubles\Checks\FileStore;
use DeployDoubles\Checks\Probes;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * The queue probe. The worker that handles it records its own commit,
 * resolved at handle time from the code the worker is running.
 */
final class ProbeJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;

    public int $tries = 1;

    public function __construct(public readonly string $probe)
    {
    }

    public function handle(FileStore $store): void
    {
        $commit = (new CommitResolver(base_path()))->resolve();
        Probes::answer($store, $this->probe, $commit, time());
    }
}
