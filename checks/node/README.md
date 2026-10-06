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

`database` (connects, engine, write then read), `storage` (writable marker), `env` (required names present), `scheduler` and `scheduler.release` (a fresh heartbeat from the in-process scheduler, one release per minute). Results older than three minutes turn the report into `scheduler: fail`.

## Security

The same rules as `deploydoubles/checks-php`, and the same report shape:

- Without a valid token the report says only pass or fail per check.
- The full tier never contains error messages, hostnames, IP addresses, usernames, paths, connection strings or environment values. Errors are mapped to fixed codes by their `code` (SQLSTATE or Node system error) — messages are never read.
- Tokens and run IDs are compared in constant time (`crypto.timingSafeEqual`).
- A request only reads stored results. It never runs a check or opens a connection.

## Licence

MIT.
