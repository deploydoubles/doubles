<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Symfony;

/**
 * The queue probe. Carries only the probe's store name.
 */
final class ProbeMessage
{
    public function __construct(public readonly string $probe) {}
}
