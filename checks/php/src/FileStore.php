<?php

declare(strict_types=1);

namespace DeployDoubles\Checks;

use Closure;
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

    /** A marker file that exists but stays unreadable this long is treated as lost. */
    private const PARTIAL_WRITE_GRACE = 5;

    /** @var Closure(string, string): bool */
    private Closure $link;

    /**
     * @param (Closure(string, string): bool)|null $link creates a hard link; replaceable so the
     *        fallback for filesystems without hard links can be tested
     */
    public function __construct(private readonly string $directory, ?Closure $link = null)
    {
        $this->link = $link ?? static fn (string $target, string $path): bool => @link($target, $path);
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
     * Creates the file only when it does not exist yet, atomically: the first
     * writer wins. Returns the stored data, or null when nothing could be
     * stored (an unwritable store), so the caller can say so instead of
     * trying again on every request.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>|null
     */
    public function createIfAbsent(string $name, array $data): ?array
    {
        $existing = $this->read($name);
        if ($existing !== null) {
            return $existing;
        }

        $path = $this->path($name);
        try {
            $this->ensureDirectory();
            $json = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
            $temp = $path.'.'.bin2hex(random_bytes(6)).'.tmp';
            if (@file_put_contents($temp, $json) !== false) {
                // link() fails when the target exists, so the first writer wins atomically.
                $linked = ($this->link)($temp, $path);
                @unlink($temp);
                if (! $linked && ! is_file($path)) {
                    // No hard links on this filesystem: an exclusive create is
                    // just as first-writer-wins, only not atomic for readers.
                    $this->createExclusive($path, $json);
                }
            }
        } catch (\Throwable) {
            // Nothing could be stored; the read below says so.
        }

        $stored = $this->read($name);
        if ($stored !== null) {
            return $stored;
        }

        // Another writer may be half-way through an exclusive create.
        $age = $this->age($name, time());

        return $age !== null && $age <= self::PARTIAL_WRITE_GRACE ? $data : null;
    }

    private function createExclusive(string $path, string $json): void
    {
        $handle = @fopen($path, 'x');
        if ($handle === false) {
            return;
        }
        try {
            @fwrite($handle, $json);
        } finally {
            @fclose($handle);
        }
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
        foreach (@scandir($this->directory) ?: [] as $entry) {
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
