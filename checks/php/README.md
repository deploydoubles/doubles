# deploydoubles/checks-php

Generates the [deploy report](https://github.com/deploydoubles/doubles/blob/main/spec/report.md) — `GET /.well-known/deploy-report` — for PHP applications, so a pipeline, an agent or a monitor can tell whether a deploy actually works.

Laravel is supported today. Symfony and plain PHP follow.

> This package is developed in the [`deploydoubles/doubles`](https://github.com/deploydoubles/doubles) monorepo. Its own repository is a read-only mirror; open issues and pull requests in the monorepo.

## Install (Laravel)

```sh
composer require deploydoubles/checks-php
```

The service provider is auto-discovered. It:

- serves `GET /.well-known/deploy-report` (no session, no cookies);
- schedules `php artisan deploy-report:run` every minute, which runs the checks and stores their results in `storage/deploy-report/`.

Make sure the app's scheduler runs (`php artisan schedule:work`, or `schedule:run` from cron every minute) and that `storage/` is shared by the web process, the queue workers and the scheduler.

## Configure

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
