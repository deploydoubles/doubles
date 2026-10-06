# php-mysql

A **deploy double**: a reference app in plain PHP — no framework — that exists to be deployed and checked. It uses MySQL and one cron job, and serves a [deploy report](https://github.com/deploydoubles/doubles/blob/main/spec/report.md) at `/.well-known/deploy-report` so anyone can verify a deploy of it from outside.

> **Read-only mirror.** This app is developed in the [`deploydoubles/doubles`](https://github.com/deploydoubles/doubles) monorepo under `doubles/php-mysql/`. Open issues and pull requests there.

## What it needs

Everything is declared in [`double.json`](double.json):

| | |
|---|---|
| Runtime | PHP 8.3+ with `pdo_mysql` |
| Services | MySQL |
| Processes | web (document root `public/`, every path through `public/index.php`); cron: `php vendor/bin/deploy-report-run` every minute from the app root ([`crontab`](crontab)) |
| Environment | `APP_ENV`; the database as a URL (`DATABASE_URL`) or discrete variables (`DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`) — as real variables or in a `.env` file in the app root |
| Build | `composer install --no-dev --optimize-autoloader` |

`storage/` must be persistent and shared by the web process and the cron job.

## Verify a deploy

```sh
npx deploydoubles verify https://your-deploy.example --commit <deployed sha> --json
```

The report serves the full tier publicly (committed in `deploy-report.php`), so no token is needed. Exit `0` means every check passed on the commit you deployed.

## Run it locally

From the monorepo root:

```sh
(cd verifier && npm ci && npm run build)
scripts/conformance.sh php-mysql
```

`docker-compose.yml` builds from the monorepo root; `docker/Dockerfile` also builds on its own from this directory (`docker build -f docker/Dockerfile .`).

## Maintainer

Jan Peter Wiersma.
