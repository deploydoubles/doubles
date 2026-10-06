# laravel-mysql-redis-worker

A **deploy double**: a reference Laravel app that exists to be deployed and checked. It uses MySQL, Redis for cache and queue, a queue worker and the scheduler, and serves a [deploy report](https://github.com/deploydoubles/doubles/blob/main/spec/report.md) at `/.well-known/deploy-report` so anyone can verify a deploy of it from outside.

> **Read-only mirror.** This app is developed in the [`deploydoubles/doubles`](https://github.com/deploydoubles/doubles) monorepo under `doubles/laravel-mysql-redis-worker/`. Open issues and pull requests there.

## What it needs

Everything is declared in [`double.json`](double.json):

| | |
|---|---|
| Runtime | PHP 8.3+ with `pdo_mysql` and `redis` |
| Services | MySQL, Redis (cache and queue) |
| Processes | web, `php artisan queue:work`, `php artisan schedule:work` (or `schedule:run` every minute) |
| Environment | `APP_KEY` (generate it); database and Redis settings as a URL (`DATABASE_URL`, `REDIS_URL`) or discrete variables (`DB_HOST`, `REDIS_HOST`, …) |
| Release step | `php artisan migrate --force` |

`storage/` must be persistent and shared by the web process, the worker and the scheduler.

## Verify a deploy

```sh
npx deploydoubles verify https://your-deploy.example --commit <deployed sha> --json
```

The report serves the full tier publicly (committed in `config/deploy-report.php`), so no token is needed. Exit `0` means every check passed on the commit you deployed.

## Run it locally

From the monorepo root:

```sh
(cd verifier && npm ci && npm run build)
scripts/conformance.sh laravel-mysql-redis-worker
```

`docker-compose.yml` builds from the monorepo root; `docker/Dockerfile` also builds on its own from this directory (`docker build -f docker/Dockerfile .`).

Compose hands the app its settings the way most PHP hosts do: `docker/conformance.env` is mounted as the app's `.env`, and `docker/entrypoint.sh` runs `php artisan config:cache` before every process starts. With the configuration cached Laravel never reads `.env` again, so the run also proves the report copes with that.

## Maintainer

Jan Peter Wiersma.
