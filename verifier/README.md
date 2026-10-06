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
| `--token <t>` | `DEPLOY_REPORT_TOKEN`, sent as `Authorization: Bearer`, to read the full report. |
| `--during-deploy` | Start before the deploy: sends a request every 250 ms until the new commit serves, then counts failed requests and the longest gap. Any failed request fails the run. |
| `--timeout <s>` | Seconds to wait for the report to settle. Default 300. |
| `--json` | Print one JSON object and nothing else. |

It polls the report until it is settled and the expected commit is serving, honouring `retry_after`. For `https://` URLs on a non-loopback host it also checks TLS and the HTTP→HTTPS redirect.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Every check passed on the deployed commit |
| `1` | A check failed |
| `2` | Still pending when the timeout passed |
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

`downtime` (`failed`, `longest_gap_ms`) is added with `--during-deploy`. The token and run ID never appear in the output.

## list

`deploydoubles list` will pick a double from the catalog. The catalog is not published yet; today it returns an empty list.

## Licence

MIT. Developed in the [`deploydoubles/doubles`](https://github.com/deploydoubles/doubles) monorepo.
