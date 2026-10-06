<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

/**
 * Reads process environment variables from every place PHP exposes them.
 */
final class Environment
{
    public static function get(string $name): ?string
    {
        foreach ([$_SERVER[$name] ?? null, $_ENV[$name] ?? null, getenv($name)] as $value) {
            if (is_string($value) && $value !== '') {
                return $value;
            }
        }

        return null;
    }
}
