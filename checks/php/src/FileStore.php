<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

use RuntimeException;

/**
 * The result store: a few small JSON files in the app's persistent storage.
 *
 * Every write goes to a temporary file first and is renamed into place, so a
 * reader never sees a half-written file. The store never touches the cache or
 * database it is checking.
 */
final class FileStore
{
    private const NAME = '/^[a-z0-9][a-z0-9._-]*$/';

    public function __construct(private readonly string $directory)
    {
    }

    public function directory(): string
    {
        return $this->directory;
    }

    /** @param array<string, mixed> $data */
    public function write(string $name, array $data): void
    {
        $this->ensureDirectory();
        $path = $this->path($name);
        $temp = $path.'.'.bin2hex(random_bytes(6)).'.tmp';

        if (@file_put_contents($temp, json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES)) === false) {
            throw new RuntimeException('deploy-report store write failed');
        }
        if (! @rename($temp, $path)) {
            @unlink($temp);
            throw new RuntimeException('deploy-report store rename failed');
        }
    }

    /**
     * Creates the file only when it does not exist yet. Returns the stored data.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function createIfAbsent(string $name, array $data): array
    {
        $existing = $this->read($name);
        if ($existing !== null) {
            return $existing;
        }

        try {
            $this->ensureDirectory();
            $path = $this->path($name);
            $temp = $path.'.'.bin2hex(random_bytes(6)).'.tmp';
            if (@file_put_contents($temp, json_encode($data, JSON_THROW_ON_ERROR)) !== false) {
                // link() fails when the target exists, so the first writer wins atomically.
                @link($temp, $path);
                @unlink($temp);
            }
        } catch (\Throwable) {
            // A read-only store degrades to "no marker": callers treat that as unknown.
        }

        return $this->read($name) ?? $data;
    }

    /** @return array<string, mixed>|null */
    public function read(string $name): ?array
    {
        $path = $this->path($name);
        if (! is_file($path)) {
            return null;
        }
        $raw = @file_get_contents($path);
        if ($raw === false || $raw === '') {
            return null;
        }
        try {
            $data = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        return is_array($data) ? $data : null;
    }

    /** @return list<string> file names (without directory) that start with $prefix */
    public function names(string $prefix): array
    {
        if (! is_dir($this->directory)) {
            return [];
        }
        $names = [];
        foreach (scandir($this->directory) ?: [] as $entry) {
            if (str_starts_with($entry, $prefix) && str_ends_with($entry, '.json')) {
                $names[] = substr($entry, 0, -5);
            }
        }
        sort($names);

        return $names;
    }

    public function delete(string $name): void
    {
        @unlink($this->path($name));
    }

    public function age(string $name, int $now): ?int
    {
        $mtime = @filemtime($this->path($name));

        return $mtime === false ? null : $now - $mtime;
    }

    private function path(string $name): string
    {
        if (! preg_match(self::NAME, $name)) {
            throw new RuntimeException('invalid deploy-report store name');
        }

        return rtrim($this->directory, '/').'/'.$name.'.json';
    }

    private function ensureDirectory(): void
    {
        if (! is_dir($this->directory) && ! @mkdir($this->directory, 0775, true) && ! is_dir($this->directory)) {
            throw new RuntimeException('deploy-report store directory could not be created');
        }
    }
}
