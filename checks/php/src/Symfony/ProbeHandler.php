<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Symfony;

use DeployDoubles\Checks\CommitResolver;
use DeployDoubles\Checks\FileStore;
use DeployDoubles\Checks\Probes;

/**
 * Answers the queue probe. The worker resolves its own commit at handle time,
 * from the code it is running.
 */
final class ProbeHandler
{
    public function __construct(private readonly FileStore $store, private readonly string $projectDir) {}

    public function __invoke(ProbeMessage $message): void
    {
        $commit = (new CommitResolver($this->projectDir))->resolve();
        Probes::answer($this->store, $message->probe, $commit, time());
    }
}
