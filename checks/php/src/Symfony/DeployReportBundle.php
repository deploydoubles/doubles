<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Symfony;

/**
 * Placeholder for the Symfony bundle. Not registered anywhere yet: the
 * Symfony adapter (route, console command, Messenger probe) lands with the
 * first Symfony double and reuses the core store, tier filter and error
 * mapper unchanged.
 */
final class DeployReportBundle
{
}
