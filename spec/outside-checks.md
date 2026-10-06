# Outside checks — v0.1 (draft)

**Status**: draft, v0.x. The key words MUST, MUST NOT, SHOULD and MAY are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

Inside checks are what an application can observe about itself (see [report](report.md)). Outside checks are what only an observer outside the application can see. A **verifier** runs them, reads the report, and returns **one exit code**.

## Checks

| Name | What the verifier observes | Catches |
|---|---|---|
| `reachability` | The URL answers with a deploy report | Routing failures; probes that only reached a loopback address |
| `tls` | For `https://` URLs on a non-loopback host: the certificate is valid for the host | Missing or expired certificates |
| `https_redirect` | For `https://` URLs on a non-loopback host: the `http://` URL redirects to `https://` | Plain-HTTP exposure |
| `release` | `deploy.release.commit` equals the deployed commit | A stale release still serving |
| `run_id` | `deploy.release.run_id_match` is `true` (only when a run ID was given) | Environment variables that never reached the app |
| `report` | The report agrees with itself (its `status`, its HTTP status and its checks; check names follow the specification) and is fresh (see below) | A report that says it failed without saying why; results left by an earlier deploy of the same commit |
| `downtime` | Failed requests and the longest gap between successful responses while a release switches | Dropped requests during a deploy |
| `rollback` | After rolling back, the previous commit serves and the report is green again | A rollback that does not restore |
| `persistence` | The storage marker of an earlier release survives a redeploy | Data lost on redeploy |
| `detection` | What a platform inferred about the app, compared with its manifest | Detection bugs |

`rollback`, `persistence` and `detection` are scenarios composed from several verifier runs and platform steps; v0.1 defines their names, not a protocol.

## Verifying a deploy

A verifier given a URL, the deployed commit and optionally a run ID and a token:

1. requests `<url>/.well-known/deploy-report`, sending `Authorization: Bearer <token>` when a token is given and `Deploy-Run-Id: <id>` when a run ID is given;
2. for `https://` URLs on a non-loopback host, checks TLS and the HTTP→HTTPS redirect;
3. polls the report until `deploy.settled` is `true`, the expected commit is serving, and the report is **fresh**, or until its timeout, honouring `retry_after` when present;
4. compares `deploy.release.commit` with the expected commit, and the run ID match only when a run ID was given;
5. exits with one code.

A response counts as a report when it parses as JSON and has a top-level `status` and a `deploy` object, whatever its HTTP status (a failing report is served with HTTP 503).

**Fresh.** A settled report on the expected commit counts only when its newest `checked_at` is at or after the moment the verifier first saw that commit serving — on the server's clock (its `Date` response header) when it sends one. After a rollback, or a redeploy of a commit that ran before, the stored results can describe the earlier deployment until the application's scheduler runs again; they are dated before the switch, and the verifier keeps polling. A report whose checks carry no `checked_at` cannot be fresh. At the timeout, a report that never became fresh is `pending` (exit `2`), unless a check in it failed.

**The report's own verdict.** A verifier MUST NOT exit `0` when the report's top-level `status` is `fail`, when its HTTP status is not the one its `status` requires (`200` for `pass` and `warn`, `503` for `fail`), or when the report disagrees with its own checks (for example `503` with no failing check). Such a report fails the `report` check.

**Credentials stay with the URL.** A verifier MUST NOT send a token over plain `http://` to a host other than a loopback address, and MUST NOT send `Authorization` or `Deploy-Run-Id` to another origin: it follows redirects only within the origin it was given.

**Remote text is never printed.** A report is input from the application, not from the verifier's user. A verifier MUST NOT print a report's `hint`, `detail` or any other free text: it prints its own hint for each `code` (a generic one for a code it does not know), replaces check names that do not match the specification's pattern (and fails the `report` check), and strips control characters from everything it prints.

## Exit codes

The exit code is the whole contract. Per-check detail explains a result; it never decides it.

| Code | Meaning |
|---|---|
| `0` | Every check in the report passed (or warned, or was skipped) on the expected release, and every outside check passed |
| `1` | A check failed — an inside check in the report, or an outside check such as `https_redirect`, `report` or `downtime` — or the report itself says it failed |
| `2` | When the timeout passed, the report was still not settled or not fresh, or `--during-deploy` never saw the previous release |
| `3` | Unreachable (no report could be read, or TLS failed), the wrong release answered, or the run ID did not match |

When several apply, the highest-priority code wins, in the order `3`, `1`, `2`. When a result is ambiguous, a verifier MUST exit non-zero.

## Measuring downtime

During a deploy, a verifier sends a steady stream of requests (one every 250 ms) to the report until the expected commit serves. A request fails when it errors at the network level, times out, or returns something that is not a report. Any failed request fails the `downtime` check; the verifier reports the number of requests, the number of failed requests and the longest gap between two successful responses, in milliseconds.

A measurement that never saw the previous release answer measured no switch: the new release was already serving when it started. The `downtime` check is then `pending`, never `pass`.

## Detection

A platform MUST NOT read an application's manifest to configure it — that would turn a detection test into a lookup. Detection is compared outside the platform: an adapter turns what the platform inferred into the manifest's terms (runtime, database engine, cache engine) and reports every missing and every unexpected item as a mismatch.
