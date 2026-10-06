<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Checks;

use PDO;

/**
 * Turns server version banners into `engine major.minor`, the only form the
 * report allows. The banner itself never leaves this class.
 */
final class Engines
{
    public static function fromPdo(PDO $pdo): string
    {
        $driver = (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        $banner = (string) @$pdo->getAttribute(PDO::ATTR_SERVER_VERSION);

        return match ($driver) {
            'mysql' => stripos($banner, 'mariadb') !== false
                ? self::format('mariadb', self::mariadbVersion($banner))
                : self::format('mysql', self::majorMinor($banner)),
            'pgsql' => self::format('postgres', self::majorMinor($banner)),
            'sqlite' => self::format('sqlite', self::majorMinor($banner)),
            default => self::format(preg_replace('/[^a-z0-9-]/', '', strtolower($driver)) ?: 'unknown', null),
        };
    }

    /**
     * @param array<string, mixed> $info the parsed `INFO server` section
     */
    public static function fromRedisInfo(array $info): string
    {
        if (isset($info['valkey_version']) || (isset($info['server_name']) && strtolower((string) $info['server_name']) === 'valkey')) {
            return self::format('valkey', self::majorMinor((string) ($info['valkey_version'] ?? $info['redis_version'] ?? '')));
        }

        return self::format('redis', self::majorMinor((string) ($info['redis_version'] ?? '')));
    }

    /** Engines that satisfy an expectation: valkey speaks the redis protocol. */
    public static function satisfies(?string $expected, string $observedEngine): bool
    {
        if ($expected === null) {
            return true;
        }
        if ($expected === $observedEngine) {
            return true;
        }

        return in_array($expected, ['redis', 'valkey'], true) && in_array($observedEngine, ['redis', 'valkey'], true);
    }

    public static function engine(string $observed): string
    {
        return explode(' ', $observed, 2)[0];
    }

    private static function majorMinor(string $banner): ?string
    {
        return preg_match('/(\d+)\.(\d+)/', $banner, $m) ? ((int) $m[1]).'.'.((int) $m[2]) : null;
    }

    private static function mariadbVersion(string $banner): ?string
    {
        // e.g. "5.5.5-10.11.6-MariaDB-1:10.11.6+maria~ubu2204"
        if (preg_match('/(\d+)\.(\d+)\.\d+-MariaDB/i', $banner, $m)) {
            return ((int) $m[1]).'.'.((int) $m[2]);
        }

        return self::majorMinor($banner);
    }

    private static function format(string $engine, ?string $version): string
    {
        return $version === null ? $engine : $engine.' '.$version;
    }
}
