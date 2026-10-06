<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Standalone;

use Closure;
use DeployDoubles\Checks\Checks\Engines;
use DeployDoubles\Checks\Checks\EnvCheck;
use DeployDoubles\Checks\Checks\StorageCheck;
use DeployDoubles\Checks\Checks\WriteProbe;
use DeployDoubles\Checks\CheckResult;
use DeployDoubles\Checks\Codes;
use PDO;

/**
 * The run-time checks for an app without a framework: the database through
 * the PDO connection the app's config hands over, storage and env. There is
 * no queue. Errors propagate to the Runner, which maps them to fixed codes.
 */
final class StandaloneChecks
{
    public function __construct(private readonly StandaloneConfig $standalone, private readonly ?string $commit)
    {
    }

    /** @return array<string, Closure(): CheckResult> */
    public function all(): array
    {
        $checks = [
            'storage' => fn () => (new StorageCheck($this->standalone->markerPath, $this->commit))(),
            'env' => fn () => (new EnvCheck($this->standalone->config->requiredEnv()))(),
        ];
        if ($this->standalone->database !== null) {
            $checks['database'] = $this->database(...);
        }

        return $checks;
    }

    public function database(): CheckResult
    {
        $expected = $this->standalone->config->expected('database');
        $pdo = ($this->standalone->database)();
        if (! $pdo instanceof PDO) {
            return CheckResult::fail(Codes::DATABASE_ERROR, 'the configured connection is not a PDO instance', $expected);
        }
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $observed = Engines::fromPdo($pdo);

        if (! Engines::satisfies($expected, Engines::engine($observed))) {
            return CheckResult::fail(Codes::DATABASE_ENGINE_MISMATCH, 'connected to a different engine than declared', $expected, $observed);
        }

        $written = WriteProbe::run(
            (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME),
            static fn (string $sql) => $pdo->exec($sql),
            static fn (string $sql, string $value) => $pdo->prepare($sql)->execute([$value]),
            static fn (string $sql) => $pdo->query($sql)->fetchColumn(),
            $expected,
            $observed,
        );
        if ($written !== null) {
            return $written;
        }

        return CheckResult::pass('connected; write then read ok', $expected, $observed);
    }
}
