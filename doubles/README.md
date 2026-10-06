# Doubles

Reference apps that implement the [deploy report](../spec/report.md). Each lives in `doubles/<id>/` with a `double.json` manifest, a `docker-compose.yml` and an `AGENTS.md`.

| Double | Stack |
|---|---|
| [`laravel-mysql-redis-worker`](laravel-mysql-redis-worker/) | Laravel, MySQL, Redis cache and queue, a queue worker and the scheduler |
| [`symfony-postgres-worker`](symfony-postgres-worker/) | Symfony, Postgres, a Messenger worker on the Doctrine transport, a cron job |
| [`php-mysql`](php-mysql/) | Plain PHP (no framework), MySQL, a cron job |
| [`nextjs-postgres`](nextjs-postgres/) | Next.js (App Router), Postgres, checks on an in-process timer |

After adding or changing a double, run `scripts/build-catalog` and commit `catalog.json`.
