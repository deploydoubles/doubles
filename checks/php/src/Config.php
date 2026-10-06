<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

/**
 * The report configuration.
 *
 * `tier` comes only from the app's committed configuration file — adapters
 * must never fill it from an environment variable. `token` and `runId` are
 * the only values that come from the environment.
 */
final class Config
{
    public const KNOWN_CHECKS = ['database', 'cache', 'queue', 'queue.release', 'scheduler', 'scheduler.release', 'storage', 'assets', 'env'];

    /** @var array<string, array<string, mixed>> */
    public readonly array $checks;

    /**
     * @param array<string, array<string, mixed>> $checks declared checks, in report order,
     *        each with optional `expected` (engine name) and, for `env`, `required` names
     */
    public function __construct(
        public readonly string $storePath,
        array $checks,
        public readonly string $tier = 'public',
        public readonly ?string $token = null,
        public readonly ?string $runId = null,
        public readonly ?string $appName = null,
        public readonly ?string $double = null,
        public readonly ?string $framework = null,
    ) {
        $declared = [];
        foreach (self::KNOWN_CHECKS as $name) {
            if (array_key_exists($name, $checks)) {
                $declared[$name] = is_array($checks[$name]) ? $checks[$name] : [];
            }
        }
        $this->checks = $declared;
    }

    public function declares(string $check): bool
    {
        return array_key_exists($check, $this->checks);
    }

    public function expected(string $check): ?string
    {
        $value = $this->checks[$check]['expected'] ?? null;

        return is_string($value) && preg_match('/^[a-z0-9-]+$/', $value) ? $value : null;
    }

    /** @return list<string> */
    public function requiredEnv(): array
    {
        $names = $this->checks['env']['required'] ?? [];

        return array_values(array_filter(
            is_array($names) ? $names : [],
            static fn ($name) => is_string($name) && preg_match('/^[A-Z][A-Z0-9_]*$/', $name) === 1,
        ));
    }

    public function servesFullTierWithoutToken(): bool
    {
        return $this->tier === 'full';
    }
}
