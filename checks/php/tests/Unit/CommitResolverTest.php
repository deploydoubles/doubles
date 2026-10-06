<?php

use DeployDoubles\Checks\CommitResolver;

function noEnv(): Closure
{
    return static fn (string $name): ?string => null;
}

it('resolves each platform variable', function (string $var) {
    $sha = str_repeat('b', 40);
    $env = static fn (string $name): ?string => $name === $var ? strtoupper($sha) : null;

    expect((new CommitResolver(tempDir(), $env))->resolve())->toBe($sha);
})->with(CommitResolver::ENV_VARS);

it('prefers platform variables over REVISION and .git', function () {
    $dir = tempDir();
    file_put_contents($dir.'/REVISION', str_repeat('c', 40));
    $env = static fn (string $name): ?string => $name === 'DEPLOY_COMMIT' ? str_repeat('d', 40) : null;

    expect((new CommitResolver($dir, $env))->resolve())->toBe(str_repeat('d', 40));
});

it('reads a REVISION file', function () {
    $dir = tempDir();
    file_put_contents($dir.'/REVISION', str_repeat('c', 40)."\n");

    expect((new CommitResolver($dir, noEnv()))->resolve())->toBe(str_repeat('c', 40));
});

it('reads a detached .git/HEAD', function () {
    $dir = tempDir();
    mkdir($dir.'/.git');
    file_put_contents($dir.'/.git/HEAD', str_repeat('e', 40)."\n");

    expect((new CommitResolver($dir, noEnv()))->resolve())->toBe(str_repeat('e', 40));
});

it('follows one ref indirection to a loose ref', function () {
    $dir = tempDir();
    mkdir($dir.'/.git/refs/heads', 0777, true);
    file_put_contents($dir.'/.git/HEAD', "ref: refs/heads/main\n");
    file_put_contents($dir.'/.git/refs/heads/main', str_repeat('f', 40)."\n");

    expect((new CommitResolver($dir, noEnv()))->resolve())->toBe(str_repeat('f', 40));
});

it('falls back to packed-refs', function () {
    $dir = tempDir();
    mkdir($dir.'/.git');
    file_put_contents($dir.'/.git/HEAD', "ref: refs/heads/main\n");
    file_put_contents($dir.'/.git/packed-refs', "# pack-refs with: peeled fully-peeled sorted\n".str_repeat('1', 40)." refs/heads/other\n".str_repeat('2', 40)." refs/heads/main\n^".str_repeat('3', 40)."\n");

    expect((new CommitResolver($dir, noEnv()))->resolve())->toBe(str_repeat('2', 40));
});

it('follows a .git file pointing at the real git directory', function () {
    $dir = tempDir();
    $real = tempDir();
    file_put_contents($real.'/HEAD', str_repeat('9', 40));
    file_put_contents($dir.'/.git', 'gitdir: '.$real."\n");

    expect((new CommitResolver($dir, noEnv()))->resolve())->toBe(str_repeat('9', 40));
});

it('treats anything that is not a full hex sha as unresolved', function () {
    $dir = tempDir();
    file_put_contents($dir.'/REVISION', 'v1.2.3 deployed by someone@host');
    $env = static fn (string $name): ?string => $name === 'DEPLOY_COMMIT' ? 'abc123' : null;

    expect((new CommitResolver($dir, $env))->resolve())->toBeNull();
});

it('never runs a git binary', function () {
    $source = file_get_contents(__DIR__.'/../../src/CommitResolver.php');

    expect($source)->not->toMatch('/\b(exec|shell_exec|proc_open|popen|system|passthru)\s*\(/');
});
