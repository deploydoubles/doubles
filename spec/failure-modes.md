# Failure modes — v0.1 (draft)

**Status**: draft, v0.x. The key words MUST, MUST NOT, SHOULD and MAY are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

A double that deploys cleanly tests what a platform does with a good release. A **failure mode** tests what it does with a bad one: the double fails on purpose, at a known stage, and the test judges whether the platform noticed and kept the previous release serving.

A double lists the modes it can produce in its [manifest](manifest.md) (`failure_modes`). A double that lists none, or that is deployed without the variable below, behaves exactly as it always does.

## The variable

```
DOUBLE_FAIL=<mode>@<commit>
```

Set in the application's environment, the way any other setting reaches it on the platform under test. `<mode>` is a mode id from the table below; `<commit>` is the full commit SHA of the release that must fail.

A double MUST fire `<mode>` only when all of these hold:

1. the value is well-formed: exactly one `@`, a non-empty `<mode>` before it and a non-empty `<commit>` after it;
2. `<mode>` is a mode the double lists in `failure_modes`;
3. `<commit>` is, as an exact string match, the commit the running code was built from, resolved the same way the report resolves `deploy.release.commit` (see [report](report.md)). A commit the double cannot resolve never matches.

In every other case — no variable, an empty value, no `@`, an unknown mode, another commit — the double MUST behave exactly as it does without the variable. When in doubt, a double does not fire.

**Why the commit.** Platforms commonly share one set of environment variables across every release of an app. The previous release then reads the same variable when it restarts or when the platform rolls back to it. Naming the commit keeps the failure on the new release only, so the previous release stays healthy and a rollback can succeed.

**Read it where the stage runs, at run time.** A double reads the variable when the failing stage runs, not when its code is built, and through whatever survives the framework's configuration caching. A framework that caches its configuration before the release step (Laravel's `config:cache`, for example) only sees the variable through a configuration key: reading the raw environment there returns nothing, and the mode would silently never fire.

## Modes

| Mode | Stage | Expect | What the double does |
|---|---|---|---|
| `build` | `build` | `rejected` | The build step exits non-zero. |
| `migrate` | `release` | `rejected` | The release step (migrations) exits non-zero, before it changes anything. |
| `boot` | `start` | `rejected` | The application fails every web request — `/`, the health endpoint and `/.well-known/deploy-report` — or fails to start serving at all. Build and release commands are unaffected. |
| `500` | `request` | `rejected` | `/` answers HTTP 500. `/.well-known/deploy-report` and the health endpoint keep answering, so a verifier can still read the report. |
| `slow-boot` | `start` | `accepted` | For about 20 seconds after it starts serving, the application is not ready: either every request answers HTTP 503 (including the report and the health endpoint) until 20 seconds after the release's first web request, or requests are held for about 20 seconds and then answered. After that it serves normally. |

A double MUST list a mode only when it can produce it wherever that stage runs. A build step that has no access to the application's environment cannot honour `build`, so a double whose build runs that way does not list it.

### Stages

| Stage | When it runs |
|---|---|
| `build` | While the release is built: dependencies installed, assets compiled. |
| `release` | Once per release, after the build and before the release serves (for example migrations). |
| `start` | When the release's processes start and begin serving. |
| `request` | While the release serves requests. |

### Expectations

| Expect | What a platform that works does |
|---|---|
| `rejected` | Reports the deploy as failed, and the previous release is the one serving afterwards: `deploydoubles verify <url> --commit <previous commit>` exits `0`. The broken release is not kept. |
| `accepted` | Completes the deploy, and the new release serves: `deploydoubles verify <url> --commit <new commit>` exits `0`. A platform that gives up on a release because it is not ready for 20 seconds fails this mode. |

The judgement is the end state. How long a bad release served before the platform put the previous one back is outside this contract.

## Manifest

`failure_modes` in `double.json` is an array of objects, one per mode the double implements, using the stage and expectation from the table:

```json
"failure_modes": [
  { "id": "boot", "stage": "start", "expect": "rejected" },
  { "id": "500", "stage": "request", "expect": "rejected" },
  { "id": "slow-boot", "stage": "start", "expect": "accepted" }
]
```

The [schema](schema/manifest-v0.1.json) accepts only the combinations in the table. As with the rest of the manifest, a platform MUST NOT read `failure_modes` to configure an application.

## Conformance

`scripts/conformance-failure.sh <double> <mode>` starts a double with Docker Compose without the variable, waits until it is healthy, restarts its web process with `DOUBLE_FAIL=<mode>@<commit>`, and asserts what the mode does. `--other-commit` names a different commit instead and asserts that the double stays healthy.
