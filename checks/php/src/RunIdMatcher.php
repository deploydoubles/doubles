<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

/**
 * Compares the Deploy-Run-Id request header with DEPLOY_RUN_ID in constant
 * time. Answers true, false or null; the value itself is never returned.
 */
final class RunIdMatcher
{
    public const HEADER = 'Deploy-Run-Id';

    public static function match(?string $configured, ?string $presented): ?bool
    {
        if ($configured === null || $configured === '' || $presented === null || $presented === '') {
            return null;
        }

        return hash_equals($configured, trim($presented));
    }
}
