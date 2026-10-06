<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

use Closure;

/**
 * Resolves the commit the running code was built from, without configuration
 * and without a git binary:
 *
 *   1. platform variables, 2. a REVISION file, 3. the .git directory read as files.
 */
final class CommitResolver
{
    public const ENV_VARS = [
        'RAILWAY_GIT_COMMIT_SHA',
        'RENDER_GIT_COMMIT',
        'VERCEL_GIT_COMMIT_SHA',
        'SOURCE_VERSION',
        'DEPLOY_COMMIT',
    ];

    private const SHA = '/^([0-9a-f]{40}|[0-9a-f]{64})$/';

    /** @var Closure(string): ?string */
    private Closure $env;

    /** @param (Closure(string): ?string)|null $env */
    public function __construct(private readonly string $basePath, ?Closure $env = null)
    {
        $this->env = $env ?? Environment::get(...);
    }

    public function resolve(): ?string
    {
        foreach (self::ENV_VARS as $name) {
            $sha = self::normalise(($this->env)($name));
            if ($sha !== null) {
                return $sha;
            }
        }

        $sha = self::normalise($this->readFile($this->basePath.'/REVISION'));
        if ($sha !== null) {
            return $sha;
        }

        return $this->fromGitDirectory();
    }

    private function fromGitDirectory(): ?string
    {
        $gitDir = $this->basePath.'/.git';

        if (is_file($gitDir)) {
            // A .git file (worktree or submodule) points at the real directory.
            $pointer = $this->readFile($gitDir);
            if ($pointer === null || ! str_starts_with($pointer, 'gitdir:')) {
                return null;
            }
            $target = trim(substr($pointer, strlen('gitdir:')));
            $gitDir = str_starts_with($target, '/') ? $target : $this->basePath.'/'.$target;
        }

        if (! is_dir($gitDir)) {
            return null;
        }

        $head = $this->readFile($gitDir.'/HEAD');
        if ($head === null) {
            return null;
        }

        if (! str_starts_with($head, 'ref:')) {
            return self::normalise($head);
        }

        $ref = trim(substr($head, strlen('ref:')));
        if ($ref === '' || str_contains($ref, '..') || ! str_starts_with($ref, 'refs/')) {
            return null;
        }

        $loose = self::normalise($this->readFile($gitDir.'/'.$ref));
        if ($loose !== null) {
            return $loose;
        }

        $packed = $this->readFile($gitDir.'/packed-refs');
        if ($packed === null) {
            return null;
        }

        foreach (preg_split('/\R/', $packed) ?: [] as $line) {
            if ($line === '' || $line[0] === '#' || $line[0] === '^') {
                continue;
            }
            $parts = explode(' ', $line, 2);
            if (count($parts) === 2 && $parts[1] === $ref) {
                return self::normalise($parts[0]);
            }
        }

        return null;
    }

    private function readFile(string $path): ?string
    {
        if (! is_file($path) || ! is_readable($path)) {
            return null;
        }
        $contents = @file_get_contents($path, false, null, 0, 65536 * 16);

        return $contents === false ? null : trim($contents);
    }

    private static function normalise(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $value = strtolower(trim($value));

        return preg_match(self::SHA, $value) ? $value : null;
    }
}
