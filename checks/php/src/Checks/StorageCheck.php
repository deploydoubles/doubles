<?php

declare(strict_types=1);

namespace DeployDoubles\Checks\Checks;

use DeployDoubles\Checks\CheckResult;
use DeployDoubles\Checks\Codes;
use DeployDoubles\Checks\FileStore;
use DeployDoubles\Checks\Store;

/**
 * Writes a marker naming this release into persistent storage and reads it
 * back. The marker keeps every release that wrote it, so a verifier can see
 * whether earlier releases' markers survived a redeploy.
 */
final class StorageCheck
{
    private const KEEP = 20;

    public function __construct(private readonly string $directory, private readonly ?string $commit)
    {
    }

    public function __invoke(): CheckResult
    {
        if (! is_dir($this->directory) && ! @mkdir($this->directory, 0775, true) && ! is_dir($this->directory)) {
            return CheckResult::fail(Codes::STORAGE_NOT_WRITABLE, 'the storage directory could not be created');
        }

        $store = new FileStore($this->directory);
        $marker = $store->read('marker') ?? [];
        $releases = is_array($marker['releases'] ?? null) ? array_values(array_filter($marker['releases'], 'is_string')) : [];
        $key = Store::key($this->commit);

        if (! in_array($key, $releases, true)) {
            $releases[] = $key;
            $releases = array_slice($releases, -self::KEEP);
        }

        try {
            $store->write('marker', ['releases' => $releases]);
        } catch (\RuntimeException) {
            return CheckResult::fail(Codes::STORAGE_NOT_WRITABLE, 'the storage marker could not be written');
        }

        $read = $store->read('marker');
        if (! is_array($read['releases'] ?? null) || ! in_array($key, $read['releases'], true)) {
            return CheckResult::fail(Codes::STORAGE_NOT_WRITABLE, 'the storage marker did not read back');
        }

        $count = count($read['releases']);

        return CheckResult::pass('writable; markers from '.$count.' release'.($count === 1 ? '' : 's').' present');
    }
}
