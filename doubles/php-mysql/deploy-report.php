<?php

/*
 * Deploy report configuration (deploydoubles/checks-php, plain PHP).
 *
 * This is a reference app ("double"), so it serves the full tier to every
 * request: that is how a verifier reads its commit without a token, and it
 * is the public proof that the report never leaks. `tier` is a committed
 * literal on purpose — never read it from the environment. Real apps keep
 * 'public'.
 *
 * Read by the front controller (public/index.php) and by the cron runner
 * (vendor/bin/deploy-report-run), so it loads the app's environment itself:
 * cron does not pass the web server's environment along.
 */

App\load_env(__DIR__);

return [

    'tier' => 'full',

    'name' => 'php-mysql',

    'double' => 'php-mysql',

    'checks' => [
        'database' => ['expected' => 'mysql'],
        'scheduler' => [],
        'scheduler.release' => [],
        'storage' => [],
        'env' => ['required' => ['APP_ENV']],
    ],

    // The app's own connection; called only by the cron runner, never per request.
    'database' => App\db(...),

    'store_path' => __DIR__.'/storage/deploy-report',
    'storage_marker_path' => __DIR__.'/storage/app/deploy-report',

];
