<?php

declare(strict_types=1);

require dirname(__DIR__).'/vendor/autoload.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

if ($path === '/.well-known/deploy-report') {
    DeployDoubles\Checks\serve();

    return;
}

header('Content-Type: text/plain; charset=UTF-8');

if ($path === '/up') {
    echo "ok\n";

    return;
}

if ($path !== '/') {
    http_response_code(404);
    echo "not found\n";

    return;
}

echo "php-mysql — a deploy double. Its deploy report is at /.well-known/deploy-report.\n";
