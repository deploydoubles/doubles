<?php

/*
 * The whole app: read the environment (a platform's .env file or real
 * variables), and connect to MySQL from either a URL or discrete variables.
 */

declare(strict_types=1);

namespace App;

use PDO;

/**
 * Loads KEY=value lines from the app root's .env into the environment.
 * Real environment variables always win; values are never logged.
 */
function load_env(string $root): void
{
    static $loaded = false;
    if ($loaded) {
        return;
    }
    $loaded = true;

    $file = $root.'/.env';
    if (! is_file($file) || ! is_readable($file)) {
        return;
    }
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || ! str_contains($line, '=')) {
            continue;
        }
        [$name, $value] = array_map('trim', explode('=', $line, 2));
        $name = preg_replace('/^export\s+/', '', $name) ?? $name;
        if (! preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $name) || env($name) !== null) {
            continue;
        }
        if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && $value[-1] === $value[0]) {
            $value = substr($value, 1, -1);
        }
        $_ENV[$name] = $_SERVER[$name] = $value;
        putenv($name.'='.$value);
    }
}

function env(string $name): ?string
{
    foreach ([$_SERVER[$name] ?? null, $_ENV[$name] ?? null, getenv($name)] as $value) {
        if (is_string($value) && $value !== '') {
            return $value;
        }
    }

    return null;
}

/**
 * The MySQL connection: DATABASE_URL (or DB_URL) when set, otherwise DB_HOST,
 * DB_PORT, DB_DATABASE, DB_USERNAME and DB_PASSWORD.
 */
function db(): PDO
{
    $url = env('DATABASE_URL') ?? env('DB_URL');
    if ($url !== null) {
        $parts = parse_url($url);
        $host = $parts['host'] ?? '127.0.0.1';
        $port = (int) ($parts['port'] ?? 3306);
        $database = ltrim(rawurldecode($parts['path'] ?? ''), '/');
        $user = rawurldecode($parts['user'] ?? '');
        $password = rawurldecode($parts['pass'] ?? '');
    } else {
        $host = env('DB_HOST') ?? '127.0.0.1';
        $port = (int) (env('DB_PORT') ?? 3306);
        $database = env('DB_DATABASE') ?? '';
        $user = env('DB_USERNAME') ?? '';
        $password = env('DB_PASSWORD') ?? '';
    }

    return new PDO(
        sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $host, $port, $database),
        $user,
        $password,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 5],
    );
}
