<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Checks;

use Closure;
use DeployDoubles\Checks\CheckResult;
use DeployDoubles\Checks\Codes;
use DeployDoubles\Checks\Environment;

/**
 * Checks that required environment variables are present. Reports names
 * only — never a value.
 */
final class EnvCheck
{
    /** @var Closure(string): ?string */
    private Closure $env;

    /**
     * @param list<string> $required
     * @param (Closure(string): ?string)|null $env
     */
    public function __construct(private readonly array $required, ?Closure $env = null)
    {
        $this->env = $env ?? Environment::get(...);
    }

    public function __invoke(): CheckResult
    {
        $missing = [];
        foreach ($this->required as $name) {
            $value = ($this->env)($name);
            if ($value === null || $value === '') {
                $missing[] = $name;
            }
        }

        $total = count($this->required);
        if ($missing !== []) {
            return CheckResult::fail(Codes::ENV_MISSING, 'missing: '.implode(', ', $missing));
        }

        return CheckResult::pass($total.' of '.$total.' required variables present');
    }
}
