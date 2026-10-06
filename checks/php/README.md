# deploydoubles/checks-php

Generates the [deploy report](https://github.com/deploydoubles/doubles/blob/main/spec/report.md) — `GET /.well-known/deploy-report` — for PHP applications, so a pipeline, an agent or a monitor can tell whether a deploy actually works.

Laravel, Symfony and plain PHP (no framework) are supported.

> This package is developed in the [`deploydoubles/doubles`](https://github.com/deploydoubles/doubles) monorepo. Its own repository is a read-only mirror; open issues and pull requests in the monorepo.

## Install (Laravel)

```sh
composer require deploydoubles/checks-php
```

The service provider is auto-discovered. It:

- serves `GET /.well-known/deploy-report` (no session, no cookies);
- schedules `php artisan deploy-report:run` every minute, which runs the checks and stores their results in `storage/deploy-report/`.

Make sure the app's scheduler runs (`php artisan schedule:work`, or `schedule:run` from cron every minute) and that `storage/` is shared by the web process, the queue workers and the scheduler.

## Install (Symfony)

```sh
composer require deploydoubles/checks-php
```

Register the bundle in `config/bundles.php` (there is no Flex recipe yet):

```php
DeployDoubles\Checks\Symfony\DeployReportBundle::class => ['all' => true],
```

The bundle:

- answers `GET /.well-known/deploy-report` from a request listener that runs before routing and the firewall — no route import, no access rule, no session;
- adds `php bin/console deploy-report:run`, which runs the checks and stores their results in `var/deploy-report/`. Run it every minute — from cron (`* * * * * php bin/console deploy-report:run`) or from your own scheduler;
- sends the queue probe as a Messenger message on the `async` transport (`probe_transport`), so a running `messenger:consume async` worker answers it. Route `DeployDoubles\Checks\Symfony\ProbeMessage` to that transport too, so tools that read your routing see the worker.

Configure it in `config/packages/deploy_report.yaml`:

```yaml
deploy_report:
    tier: public            # a literal; an %env()% value is rejected at compile time
    checks:
        database: { expected: postgres }
        queue: { expected: database }   # doctrine transport; redis, amqp, ...
        queue.release: {}
        scheduler: {}
        scheduler.release: {}
        storage: {}
        env: { required: [APP_SECRET] }
```

`token` and `run_id` default to `DEPLOY_REPORT_TOKEN` and `DEPLOY_RUN_ID`. Without `checks`, they are inferred from the container (a Doctrine connection, the probe transport). `store_path` and `storage_marker_path` default to `var/deploy-report` and `var/storage/deploy-report`; share both between the web process, the worker and the cron job. The `database` check uses the Doctrine DBAL connection (`connection`, default `default`) and, when DoctrineMigrationsBundle is installed, reports pending migrations.

## Install (plain PHP)

```sh
composer require deploydoubles/checks-php
```

Commit a `deploy-report.php` in the app root (the directory that holds `vendor/`) that returns an array:

```php
<?php

return [
    'tier' => 'public',   // a literal; never read it from the environment
    'checks' => [
        'database' => ['expected' => 'mysql'],
        'scheduler' => [],
        'scheduler.release' => [],
        'storage' => [],
        'env' => ['required' => ['APP_ENV']],
    ],
    // Your own connection, as a closure: called by the cron runner only, never per request.
    'database' => fn (): PDO => new PDO(/* ... */),
];
```

Route the report from your front controller, and run the checks from cron:

```php
if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/.well-known/deploy-report') {
    DeployDoubles\Checks\serve();
    return;
}
```

```cron
* * * * * cd /path/to/app && php vendor/bin/deploy-report-run
```

Cron jobs usually get no environment variables: if your app reads them from a `.env` file, load it at the top of `deploy-report.php`. `token` and `run_id` default to `DEPLOY_REPORT_TOKEN` and `DEPLOY_RUN_ID`; `store_path` and `storage_marker_path` default to `storage/deploy-report` and `storage/app/deploy-report`, which must be shared by the web server and cron. There is no queue check without a framework.

## Configure (Laravel)

```sh
php artisan vendor:publish --tag=deploy-report-config
```

| Key | Default | Meaning |
|---|---|---|
| `tier` | `'public'` | Keep `'public'`. Only reference apps commit `'full'`. A literal — never read it from `env()`. |
| `token` | `env('DEPLOY_REPORT_TOKEN')` | Bearer token (≥ 32 characters) that unlocks the full tier |
| `run_id` | `env('DEPLOY_RUN_ID')` | Optional per-deploy run ID; the report answers whether the verifier's `Deploy-Run-Id` header matches |
| `checks` | `null` (inferred) | Declare checks and what you expect, e.g. `'database' => ['expected' => 'mysql']` |

Inference reads your database, cache and queue configuration. A committed declaration is better: inference cannot see a silent fallback caused by a missing environment variable — the configuration *is* the fallback.

## What it checks

`database` (connects, no pending migrations, write then read), `cache` (round trip, expected store), `queue` and `queue.release` (a probe job each minute, answered by a worker on the same commit), `scheduler` and `scheduler.release` (fresh heartbeat, one release per minute), `storage` (writable marker), `env` (required names present).

## Security

- Without a valid token the report says only pass or fail per check.
- With `Authorization: Bearer <DEPLOY_REPORT_TOKEN>` it adds versions as `engine major.minor`, the commit, fixed error codes and hints.
- It never contains exception text, hostnames, IP addresses, usernames, paths, connection strings or environment values. Errors are mapped to fixed codes by type and SQLSTATE; exception messages are never read.
- A request only reads stored results. It never runs a check, dispatches a job or touches your database or cache.

## Known limitations

- Laravel's `schedule:run` reads the cache before it runs anything. When the cache server is down, the scheduler cannot run, so the report shows `scheduler: fail` rather than `cache: fail`.

## Licence

MIT.
