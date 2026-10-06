<?php

/*
| Deploy report configuration (deploydoubles/checks-php).
|
| This is a reference app ("double"), so it serves the full tier to every
| request: that is how a verifier reads its commit without a token, and it
| is the public proof that the report never leaks. `tier` is a committed
| literal on purpose — never read it from env(). Real apps keep 'public'.
*/

return [

    'tier' => 'full',

    'token' => env('DEPLOY_REPORT_TOKEN'),

    'run_id' => env('DEPLOY_RUN_ID'),

    'name' => 'laravel-mysql-redis-worker',

    'double' => 'laravel-mysql-redis-worker',

    'checks' => [
        'database' => ['expected' => 'mysql'],
        'cache' => ['expected' => 'redis'],
        'queue' => ['expected' => 'redis'],
        'queue.release' => [],
        'scheduler' => [],
        'scheduler.release' => [],
        'storage' => [],
        'env' => ['required' => ['APP_KEY']],
    ],

    'store_path' => storage_path('deploy-report'),
    'storage_marker_path' => storage_path('app/deploy-report'),

    'probe_queue' => null,

];
