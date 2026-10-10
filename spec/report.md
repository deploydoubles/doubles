# The deploy report — v0.1 (draft)

**Status**: draft, v0.x. Breaking changes are allowed until 1.0.
**Author**: Jan Peter Wiersma.
**Schema**: [`schema/report-v0.1.json`](schema/report-v0.1.json) (JSON Schema 2020-12).

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

## Purpose

A deploy that reports success is not a deploy that works. The deploy report is a small JSON document an application serves about itself, so that anyone checking a deploy — a pipeline, an agent, a monitor — can tell whether the new release is the one answering and whether the services it depends on actually work from inside it.

The report covers **inside checks**: what the application can observe about itself. What only an outside observer can see (reachability, TLS, downtime during a release switch) is covered by [outside checks](outside-checks.md).

## Endpoints

An implementing application:

- MUST serve the report at `GET /.well-known/deploy-report`.
- SHOULD also serve `GET /up` returning HTTP 200 when the process is alive.

`/.well-known/` is reserved for site-level metadata by RFC 8615, so the report path does not collide with application routes. Implementations MUST NOT move the report to a path starting with `_`.

The report is **not a liveness probe**. A load balancer or orchestrator MUST NOT use it to decide whether an instance is alive: taking an instance out of service because a background queue is down turns a background fault into an outage. `/up` answers "is the process alive"; the report answers "does this deploy work".

## Response

- `Content-Type` MUST be `application/health+json`.
- `Cache-Control` SHOULD be `no-store`.
- The HTTP status MUST be `200` when `status` is `pass` or `warn`, and `503` when `status` is `fail`.

### Top level

The top level is compatible with the IETF health check draft (draft-inadarei-api-health-check-06): a client that understands only that draft reads `status` and the HTTP status correctly. Everything this specification adds lives under one key, `deploy`, so it never conflicts with the draft's own members (the draft defines `checks` as an object of arrays; this specification does not use that member).

| Field | Tier | Meaning |
|---|---|---|
| `status` | public | `pass`, `warn` or `fail` for the whole report |
| `deploy.spec_version` | public | `"0.1"` |
| `deploy.tier` | public | `"public"` or `"full"` — which tier this response is (see [security](security.md)) |
| `deploy.settled` | public | `false` while any check is `pending` |
| `deploy.checks` | public | Object keyed by check name; see below |
| `deploy.app` | full | Which application answered |
| `deploy.release` | full | Which release answered |

The overall `status` MUST be derived from the checks:

1. `fail` when any check is `fail`;
2. otherwise `warn` when any check is `warn` or `pending`;
3. otherwise `pass`.

`skip` checks do not affect the overall status.

### `deploy.checks`

Each key is a check name from the [inside checks](#inside-checks) table. Each value is an object:

| Field | Tier | Meaning |
|---|---|---|
| `status` | public | `pass`, `warn`, `fail`, `pending` or `skip` |
| `expected` | full | What should be there, from the application's declaration (e.g. `mysql`) |
| `observed` | full | What is actually there, as `engine` or `engine major.minor` (e.g. `mysql 8.4`, `valkey 8.1`) |
| `code` | full | On `fail` or `warn`: a fixed code from the [code table](#codes). A `skip` MAY carry one to say why the check was skipped |
| `detail` | full | One factual line produced by the implementation from a fixed template |
| `hint` | full | One platform-neutral sentence on what to do, fixed per code |
| `retry_after` | full | On `pending`: seconds until the check is worth re-reading |
| `checked_at` | full | When the evidence behind the result was produced (RFC 3339) — see below. Required in the full tier |

An application reports only the checks it declares. A check it does not declare MAY be reported as `skip` or omitted.

`observed` MUST match `^[a-z0-9-]+( [0-9]+\.[0-9]+)?$`. It is never a raw version banner or server string.

`detail` and `hint` MUST be produced by the implementation from fixed text. They MUST NOT contain anything listed in [security → never include](security.md#never-include).

`checked_at` dates the **evidence**, never the request: for a result of a scheduled run, when that run produced it; for a result derived when the report is read (for example `scheduler` from the heartbeat, or `queue` from the probes), when the newest stored record it rests on was written — the heartbeat, the answered probe, or the oldest unanswered one. A result that only says a check is still waiting (`pending`) MAY carry the time of the request. Because of this rule a verifier can tell results produced by the deployment it is checking from results an earlier deployment of the same commit left behind (see [releases that come back](#releases-that-come-back)).

### `deploy.app` (full tier)

| Field | Meaning |
|---|---|
| `name` | The application's name, from its committed report configuration only — never from an environment variable |
| `framework` | `engine major.minor`, e.g. `laravel 12.4` |
| `runtime` | `engine major.minor`, e.g. `php 8.4` |
| `double` | For reference apps ("doubles") only: the double id, e.g. `laravel-mysql-redis-worker` |

### `deploy.release` (full tier)

| Field | Meaning |
|---|---|
| `commit` | The commit the running code was built from: 40 or 64 lowercase hex characters, or `null` when it cannot be resolved |
| `booted_at` | When this release was first seen running (RFC 3339), or `null`. It resets when a release comes back (see [releases that come back](#releases-that-come-back)) |
| `run_id_match` | `true`, `false` or `null` — see below |

**`commit`** proves the *new* release is the one answering, which closes the "probe hit the old release and passed" trap. Implementations MUST resolve it without configuration, in this order:

1. A platform variable naming the deployed commit: `RAILWAY_GIT_COMMIT_SHA`, `RENDER_GIT_COMMIT`, `VERCEL_GIT_COMMIT_SHA`, `SOURCE_VERSION`, `DEPLOY_COMMIT`.
2. A `REVISION` file at the application root (the Capistrano convention).
3. The application's `.git` directory, read as files: `HEAD`, one `ref:` indirection, then the loose ref or `packed-refs`. Implementations MUST NOT run a `git` binary.

A value that is not 40 or 64 hexadecimal characters MUST be treated as unresolved.

**`run_id_match`** proves environment variables reached the running release. A deployer MAY set `DEPLOY_RUN_ID` to a fresh value per deploy and pass the same value to the verifier, which sends it in the request header `Deploy-Run-Id`. The application compares the two in constant time and answers:

- `true` — both present and equal;
- `false` — both present and different;
- `null` — `DEPLOY_RUN_ID` is not set, or the request carried no `Deploy-Run-Id` header.

The run ID value MUST NOT appear anywhere in a response. The run ID is optional: on platforms that give the running app a fixed environment, the commit is the proof of which release answers.

## Inside checks

| Check | Passes when | Catches |
|---|---|---|
| `database` | The app connects, no migrations are pending, and a write followed by a read works | Missing database, unapplied migrations |
| `cache` | A value round-trips through the configured store, and the store is the expected one | A silent fallback to a file or in-memory store |
| `queue` | A probe job is picked up and processed by a worker, and the queue backend is the expected one | No worker running; a silent fallback to synchronous execution |
| `queue.release` | The worker that processed the probe runs the same commit as the release | Workers still on the previous release |
| `scheduler` | A heartbeat written by the scheduled run is fresh | No scheduler running |
| `scheduler.release` | Within any one minute, heartbeats come from one commit only | The previous release's scheduler still running, so every scheduled job runs twice |
| `storage` | Persistent storage is writable and a marker written there reads back | Storage that is missing, read-only or not shared |
| `assets` | Built front-end assets exist | A missing build step |
| `env` | Every required environment variable is present (names only) | Configuration that never reached the app |

The storage marker also records every release that wrote it, so a verifier running a persistence scenario can tell whether earlier releases' markers survived a redeploy.

## Scheduled checks, stored results

Checks MUST run on the application's own schedule — every minute — and write their results to a **result store** owned by the implementation: a small set of files in the application's persistent storage, never the cache or database being checked. Each write MUST be atomic (write a temporary file, then rename it).

The result store MUST live in a directory that survives deploys: the same directory, with the same contents, for the web process, the workers and the scheduler of a release, and for every release after it. A store that a deploy replaces loses the boot marker and every earlier release's state, so a returning release can no longer be recognised. Implementations MUST document which directory that is and that it has to be shared between releases; a reference app ("double") MUST name it in its manifest's [`persistent_paths`](manifest.md#persistent_paths).

A request to the report endpoint MUST only read stored results. It MUST NOT run a check, dispatch a job, or write to any service it checks. Otherwise every crawler hitting the endpoint becomes a job flood. The single exception: when the store holds no boot marker for the current release, the endpoint MAY create one — when the release was first seen running (see [time bounds](#time-bounds)). That is one create-if-absent write per release, never one per request: the first writer wins, and a marker that exists is never rewritten. Implementations that know their process start time SHOULD use that instead.

When no boot marker can be stored at all (the store is not writable), the report MUST contain exactly one check, `scheduler`, with status `fail` and code `report_store_unwritable`. It MUST NOT stay `pending`: without a marker the scheduler's grace period has no start, and a pending report would hide a dead scheduler forever.

### Time bounds

A missing producer — a worker or scheduler that never runs — MUST turn the report red within a bounded time, so a verifier with a timeout of 180 seconds sees a failure rather than an endless `pending`.

- **Stale results.** When the newest stored results for the current release are older than **180 seconds**, the report MUST contain exactly one check, `scheduler`, with status `fail`, and nothing else. Its `checked_at` is the time of that last run.
- **Scheduler.** `scheduler` is `fail` when no heartbeat from the current release is newer than **120 seconds**. When the current release has never written a heartbeat, the 120 seconds are measured from the release's boot; until then it is `pending`, and every other declared check is `pending` with it. When they pass without a heartbeat, the report contains exactly one check, `scheduler`, with status `fail`.
- **Queue.** Each scheduled run dispatches one probe job, stamped with the release's commit. `queue` is evaluated when the report is read, against the **oldest unanswered** probe of the current release that was dispatched **after the newest answered probe**: `pending` while that probe is younger than **120 seconds**, `fail` once it has been outstanding longer. A fresh probe every minute therefore cannot keep a dead worker `pending`, and one probe lost on the way (a failed or dropped job) cannot fail a queue whose worker answered a later probe. When no such probe is outstanding for longer than that and at least one has been answered, `queue` is `pass`.
- **Queue release.** `queue.release` compares the commit the worker reported with the release's commit for the most recently answered probe. While no probe has been answered it is `pending`. When `queue` is `fail` because no worker answered in time, `queue.release` is `fail` too, with the same code. When the queue check itself failed — the backend is not the declared one, or the probe could not be dispatched — no probe can say which release a worker runs, and `queue.release` is `skip`.

### Releases that come back

A rollback, or a redeploy of a commit that already ran, brings back a release whose results, probes, heartbeat and boot marker may still be in the store. None of it describes the new deployment. At its first scheduled run, a returning release MUST discard that state — its heartbeat (and with it the minute it took over in), its probes and its boot marker — and run as a fresh release. A release is returning when its stored results are older than the 180-second staleness window, or older than one missed minute while another release started after them, or absent while other state for its commit remains. An implementation whose scheduler is a long-lived process (not one started every minute) MUST also judge its first run after the process starts this way: a process that has just started was not running a moment ago, so it has no missed minute to be judged by, and another release having started after its last stored run is enough. Without this, a rollback that restarts the process less than 90 seconds after the release's last run keeps the earlier life's heartbeat, whose last minute is the one the other release took over in, and `scheduler.release` fails on a handover that was legitimate.

Until that first run the report still shows the earlier deployment's results. Their `checked_at` dates them before the switch, which is how a verifier knows to keep waiting (see [outside checks → verifying a deploy](outside-checks.md#verifying-a-deploy)).

### Expected values

`expected` comes from the application's declaration: for reference apps, their manifest and committed report configuration; for any other app, its framework configuration by default, or an optional committed declaration in the implementation's configuration file. A committed declaration is recommended: inference cannot see a silent fallback caused by a missing environment variable — the configuration *is* the fallback.

## Codes

`code` MUST be one of:

| Code | Check |
|---|---|
| `database_unreachable` | database |
| `database_auth_failed` | database |
| `database_missing` | database |
| `database_migrations_pending` | database |
| `database_write_failed` | database |
| `database_write_unsupported` | database (`skip`: the server has no temporary tables, so the write test was skipped) |
| `database_engine_mismatch` | database |
| `database_error` | database |
| `cache_unreachable` | cache |
| `cache_store_mismatch` | cache |
| `cache_roundtrip_failed` | cache |
| `cache_error` | cache |
| `queue_driver_mismatch` | queue |
| `queue_no_worker` | queue, queue.release |
| `queue_release_mismatch` | queue.release |
| `queue_error` | queue |
| `scheduler_not_running` | scheduler |
| `scheduler_results_stale` | scheduler |
| `scheduler_release_mismatch` | scheduler.release |
| `report_store_unwritable` | scheduler (no boot marker could be stored; see [scheduled checks](#scheduled-checks-stored-results)) |
| `storage_not_writable` | storage |
| `storage_error` | storage |
| `assets_missing` | assets |
| `env_missing` | env |
| `check_error` | any |

Errors MUST be mapped to a code by the error's type and, for database errors, its SQLSTATE or driver error number. The error's message MUST NOT be read into the report.

## Security

The two tiers, the token rules and the list of what a report never contains are defined in [security.md](security.md). They are part of this specification.

## Examples

- [`examples/report-public.json`](examples/report-public.json) — public tier.
- [`examples/report-full.json`](examples/report-full.json) — full tier.

## Implementation notes

- Some web server configurations deny paths starting with a dot. `/.well-known/` is normally exempt because certificate challenges use it; an implementation's documentation SHOULD say how to route it to the application when it is not.
