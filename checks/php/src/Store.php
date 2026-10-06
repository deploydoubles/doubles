<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

/**
 * Names of the files in the result store, keyed by release commit.
 */
final class Store
{
    public static function key(?string $commit): string
    {
        return $commit ?? 'unknown';
    }

    public static function results(?string $commit): string
    {
        return 'results-'.self::key($commit);
    }

    public static function heartbeat(?string $commit): string
    {
        return 'heartbeat-'.self::key($commit);
    }

    public static function boot(?string $commit): string
    {
        return 'boot-'.self::key($commit);
    }

    public static function probePrefix(?string $commit): string
    {
        return 'probe-'.self::key($commit).'-';
    }

    public static function probe(?string $commit, string $id): string
    {
        return self::probePrefix($commit).$id;
    }
}
