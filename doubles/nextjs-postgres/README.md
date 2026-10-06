# nextjs-postgres

A **deploy double**: a reference Next.js (App Router) app that exists to be deployed and checked. It uses Postgres and runs its checks in-process, and serves a [deploy report](https://github.com/deploydoubles/doubles/blob/main/spec/report.md) at `/.well-known/deploy-report` so anyone can verify a deploy of it from outside.

> **Read-only mirror.** This app is developed in the [`deploydoubles/doubles`](https://github.com/deploydoubles/doubles) monorepo under `doubles/nextjs-postgres/`. Open issues and pull requests there.

## What it needs

Everything is declared in [`double.json`](double.json):

| | |
|---|---|
| Runtime | Node 24+ |
| Services | Postgres |
| Processes | web: `npm start` (`next start`, listens on `$PORT`) |
| Environment | the database as a URL (`DATABASE_URL`) or the libpq variables (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`) |
| Build | `npm ci`, `npm run build` |

## Verify a deploy

```sh
npx deploydoubles verify https://your-deploy.example --commit <deployed sha> --json
```

The report serves the full tier publicly (committed in `deploy-report.config.json`), so no token is needed. Exit `0` means every check passed on the commit you deployed.

## Run it locally

From the monorepo root:

```sh
(cd verifier && npm ci && npm run build)
scripts/conformance.sh nextjs-postgres
```

`docker-compose.yml` builds from the monorepo root; `docker/Dockerfile` also builds on its own from this directory (`docker build -f docker/Dockerfile .`).

## Maintainer

Jan Peter Wiersma.
