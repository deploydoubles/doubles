# deploydoubles

Verify that a deploy actually works. The verifier reads the app's [deploy report](https://github.com/deploydoubles/doubles/blob/main/spec/report.md), runs the [outside checks](https://github.com/deploydoubles/doubles/blob/main/spec/outside-checks.md) and returns **one exit code**.

```sh
npx deploydoubles verify https://your-deploy.example --commit <deployed sha> --json
```

Requires Node 24 or newer. No runtime dependencies.

## verify

```
deploydoubles verify <url> --commit <sha> [--run-id <id>] [--token <t>] [--during-deploy] [--timeout <s>] [--json]
```

| Option | Meaning |
|---|---|
| `--commit <sha>` | The commit you deployed. Required. Abbreviations of 7+ characters are accepted. |
| `--run-id <id>` | The `DEPLOY_RUN_ID` you set for this deploy. Sent as the `Deploy-Run-Id` header and checked only when given. |
| `--token <t>` | `DEPLOY_REPORT_TOKEN`, sent as `Authorization: Bearer`, to read the full report. Only over `https://`, or `http://` to a loopback address; anything else is a usage error. |
| `--during-deploy` | Start before the deploy: sends a request every 250 ms until the new commit serves, then counts requests, failed requests and the longest gap. Any failed request fails the run; if the old release never answered, no switch was measured and the result is pending (exit `2`). |
| `--timeout <s>` | Seconds to wait for the report to settle. Default 300. |
| `--json` | Print one JSON object and nothing else. |

It polls the report until it is settled and the expected commit is serving, honouring `retry_after`. For `https://` URLs on a non-loopback host it also checks TLS and the HTTP→HTTPS redirect.

A settled report counts only when its newest `checked_at` is at or after the moment the verifier first saw the expected commit (on the server's clock, from its `Date` header). After a rollback, or a redeploy of a commit that ran before, the app's stored results can describe the earlier deploy until its scheduler runs again; the verifier keeps polling until they don't.

The report's own verdict is never overruled: a top-level `status: fail`, an HTTP status other than 200 for `pass`/`warn` (or 503 for `fail`), or a report that disagrees with its checks never exits `0`.

Redirects are followed only within the origin you gave, so the token and run ID are never sent anywhere else. Everything printed is the verifier's own text: hints come from its fixed table by `code`, check names outside the specification are replaced, and control characters are stripped.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Every check passed on the deployed commit |
| `1` | A check failed |
| `2` | Still pending, or no result produced since the release was first seen, when the timeout passed |
| `3` | Unreachable, wrong release, or run ID mismatch |
| `64` | Usage error (bad arguments); nothing was verified |

## JSON output

```json
{
  "ok": false,
  "exit_code": 1,
  "url": "https://your-deploy.example",
  "commit": "3f2c1a9…",
  "served_commit": "3f2c1a9…",
  "checks": [
    { "name": "reachability", "status": "pass" },
    { "name": "release", "status": "pass" },
    { "name": "queue", "status": "fail", "hint": "A probe job has waited more than two minutes without being processed. Start a queue worker for this release." }
  ]
}
```

`downtime` (`requests`, `failed`, `longest_gap_ms`, `old_release_seen`) is added with `--during-deploy`. Besides the inside checks, `checks` holds the outside checks `reachability`, `tls`, `https_redirect`, `release`, `run_id` (with `--run-id`), `report` (the report is consistent and fresh) and `downtime`. The token and run ID never appear in the output.

## list

`deploydoubles list` will pick a double from the catalog. The catalog is not published yet; today it returns an empty list.

## Licence

MIT. Developed in the [`deploydoubles/doubles`](https://github.com/deploydoubles/doubles) monorepo.
