# symfony-postgres-worker

A **deploy double**: a reference Symfony app that exists to be deployed and checked. It uses Postgres, a Messenger worker on the Doctrine transport and a console command run every minute by cron, and serves a [deploy report](https://github.com/deploydoubles/doubles/blob/main/spec/report.md) at `/.well-known/deploy-report` so anyone can verify a deploy of it from outside.

> **Read-only mirror.** This app is developed in the [`deploydoubles/doubles`](https://github.com/deploydoubles/doubles) monorepo under `doubles/symfony-postgres-worker/`. Open issues and pull requests there.

## What it needs

Everything is declared in [`double.json`](double.json):

| | |
|---|---|
| Runtime | PHP 8.4+ with `pdo_pgsql` |
| Services | Postgres (database, and the Messenger transport table) |
| Processes | web (document root `public/`), `php bin/console messenger:consume async`, and `php bin/console deploy-report:run` from cron every minute |
| Environment | `APP_SECRET` (generate it); the database as a URL (`DATABASE_URL`) or discrete variables (`DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`) |
| Release step | `php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration` |

`var/deploy-report/` and `var/storage/` must be persistent and shared by the web process, the worker and the cron job.

## Verify a deploy

```sh
npx deploydoubles verify https://your-deploy.example --commit <deployed sha> --json
```

The report serves the full tier publicly (committed in `config/packages/deploy_report.yaml`), so no token is needed. Exit `0` means every check passed on the commit you deployed.

## Run it locally

From the monorepo root:

```sh
(cd verifier && npm ci && npm run build)
scripts/conformance.sh symfony-postgres-worker
```

`docker-compose.yml` builds from the monorepo root; `docker/Dockerfile` also builds on its own from this directory (`docker build -f docker/Dockerfile .`).

## Maintainer

Jan Peter Wiersma.
