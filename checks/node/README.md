# @deploydoubles/checks

Generates the [deploy report](https://github.com/deploydoubles/doubles/blob/main/spec/report.md) — `GET /.well-known/deploy-report` — for Node.js apps, so a pipeline, an agent or a monitor can tell whether a deploy actually works. Today it ships what a Next.js (App Router) app needs: a route handler and an in-process scheduler.

> This package is developed in the [`deploydoubles/doubles`](https://github.com/deploydoubles/doubles) monorepo. Its own repository is a read-only mirror; open issues and pull requests in the monorepo.

Requires Node 24 or newer. No runtime dependencies.

## Install (Next.js)

```sh
npm install @deploydoubles/checks
```

`app/.well-known/deploy-report/route.ts`:

```ts
export { GET } from '@deploydoubles/checks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
```

`instrumentation.ts` — starts the checks when the server boots: one run now, then one every 60 seconds, in the same process:

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startDeployReport } = await import('@deploydoubles/checks');
  const { Client } = await import('pg');
  startDeployReport({ database: () => new Client({ connectionString: process.env.DATABASE_URL }) });
}
```

`database` is a factory for a fresh [node-postgres](https://node-postgres.com)-compatible client; it is called once per run, never per request. In `next.config.ts`, add the package to `serverExternalPackages` so it is loaded from `node_modules` rather than bundled.

The database check is bounded: connect and queries together get 10 seconds, after which the client is ended and the check fails with `database_unreachable`. A whole scheduled run gets 45 seconds; a run that outlives that no longer holds back the next one.

### Where it runs

The checks need a long-running server process and a writable directory that outlives each deploy. Serverless functions, edge runtimes and read-only file systems are not supported: there the scheduler never runs on time, and a store the app cannot write to is reported as `scheduler: fail` with `report_store_unwritable`.

Keep `storage/` (the result store and the storage marker, see below) in a directory that is shared between releases — the persistent storage your platform offers, or Deployer's `shared_dirs`. A store that is replaced on every deploy cannot see a rollback, and makes the storage check meaningless.

## Configure

Commit `deploy-report.config.json` in the app root:

```json
{
  "tier": "public",
  "checks": {
    "database": { "expected": "postgres" },
    "scheduler": {},
    "scheduler.release": {},
    "storage": {},
    "env": { "required": ["NODE_ENV"] }
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `tier` | `"public"` | Keep `"public"`. Only reference apps commit `"full"`. It is read from this file only — never from the environment. |
| `checks` | scheduler, scheduler.release, storage | The checks this app declares, with what it expects |
| `store_path` | `storage/deploy-report` | Where results are stored |
| `storage_marker_path` | `storage/app/deploy-report` | Where the storage check writes its marker |
| `name`, `double` | none | Shown in the full tier |

`DEPLOY_REPORT_TOKEN` (≥ 32 characters, sent as `Authorization: Bearer <token>`) unlocks the full tier; `DEPLOY_RUN_ID` lets the verifier's `Deploy-Run-Id` header be matched. The commit is read from platform variables, then a `REVISION` file, then `.git` — the same order as `deploydoubles/checks-php`.

## What it checks

`database` (connects, engine, write then read through a temporary table — skipped with `database_write_unsupported` on a server without temporary tables), `storage` (writable marker), `env` (required names present), `scheduler` and `scheduler.release` (a fresh heartbeat from the in-process scheduler, one release per minute). Results older than three minutes turn the report into `scheduler: fail`; a store the app cannot write to turns it into `scheduler: fail` with `report_store_unwritable`.

An app with a queue worker can declare `queue` and `queue.release`: pass `dispatchProbe` to `startDeployReport` to enqueue a job carrying the probe name, and call `answerDeployReportProbe(probe)` from that job. A probe left unanswered for two minutes fails `queue`. Declaring `queue` or `queue.release` without passing `dispatchProbe` fails `queue` at once with `queue_driver_mismatch` (and skips `queue.release`), rather than leaving it pending.

Every `checked_at` dates the evidence (the scheduled run, the heartbeat, the answered probe), never the request. When a release comes back — a rollback, or a redeploy of a commit that ran before — its first scheduled run discards what its earlier life left in the store and starts fresh, so `booted_at` is when it was first seen running again. A rollback can restart the process less than 90 seconds after the release's last run, which is too soon to be recognised as a return; the minute the process started in is then recorded as a takeover minute, so the handover is not reported as two releases running in the same minute.

## Security

The same rules as `deploydoubles/checks-php`, and the same report shape:

- Without a valid token the report says only pass or fail per check.
- The full tier never contains error messages, hostnames, IP addresses, usernames, paths, connection strings or environment values. Errors are mapped to fixed codes by their `code` (SQLSTATE, Node system error or mysql2 code) or driver error number, exactly as checks-php maps them; a connect that fails without any code counts as `database_unreachable`. Messages are never read.
- Tokens and run IDs are compared in constant time (`crypto.timingSafeEqual`).
- A request only reads stored results. It never runs a check or opens a connection.

## Licence

MIT.
