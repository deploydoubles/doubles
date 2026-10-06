<?php

/*
| Deploy report configuration (deploydoubles/checks-php).
|
| Publish with: php artisan vendor:publish --tag=deploy-report-config
*/

return [

    /*
    | Which tier every request gets without a token: 'public' or 'full'.
    |
    | Keep this a literal in your committed config. Never read it from env():
    | a hosting platform must not be able to switch on the full tier by
    | accident. Reference apps ("doubles") commit 'full'; real apps keep
    | 'public' and use DEPLOY_REPORT_TOKEN to read the full tier.
    */
    'tier' => 'public',

    /*
    | Bearer token for the full tier: at least 32 characters, sent as
    | "Authorization: Bearer <token>". Shorter tokens are ignored.
    */
    'token' => env('DEPLOY_REPORT_TOKEN'),

    /*
    | Optional per-deploy run ID. The report answers whether the verifier's
    | Deploy-Run-Id header matches it; the value is never shown.
    */
    'run_id' => env('DEPLOY_RUN_ID'),

    /*
    | Name shown in the full tier. A committed literal, not APP_NAME.
    */
    'name' => null,

    /*
    | For reference apps only: the double id.
    */
    'double' => null,

    /*
    | The checks this app declares, with what it expects. Null infers them
    | from the app's database, cache and queue configuration. A committed
    | declaration is recommended: inference cannot see a silent fallback.
    |
    | Example:
    |   'checks' => [
    |       'database' => ['expected' => 'mysql'],
    |       'cache' => ['expected' => 'redis'],
    |       'queue' => ['expected' => 'redis'],
    |       'queue.release' => [],
    |       'scheduler' => [],
    |       'scheduler.release' => [],
    |       'storage' => [],
    |       'env' => ['required' => ['APP_KEY']],
    |   ],
    */
    'checks' => null,

    /*
    | Where results are stored (not the cache or database being checked),
    | and where the storage check writes its marker.
    */
    'store_path' => storage_path('deploy-report'),
    'storage_marker_path' => storage_path('app/deploy-report'),

    /*
    | Queue the probe job is pushed to (null: the connection's default queue).
    */
    'probe_queue' => null,

];
