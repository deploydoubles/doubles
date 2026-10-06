# Report security — v0.1 (draft)

This document is normative and part of the [report specification](report.md). The key words MUST, MUST NOT, SHOULD and MAY are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

A standard path is a path every scanner learns. The report is therefore **safe by default**: without a credential it says no more than a health endpoint already says, and even with one it never contains anything an attacker could use.

## Two tiers

| | Public tier | Full tier |
|---|---|---|
| Served when | Always, unless the full tier applies | The request carries a valid bearer token, **or** the application's own committed configuration sets `tier: full` |
| Top level | `status` | `status` |
| `deploy` | `spec_version`, `tier`, `settled`, `checks` | everything in the public tier, plus `app` and `release` |
| Per check | `status` only | `status`, `expected`, `observed`, `code`, `detail`, `hint`, `retry_after`, `checked_at` |

The public tier MUST NOT contain `deploy.app`, `deploy.release`, or any per-check field other than `status`.

When it is unclear which tier a field belongs to, it belongs to the full tier.

### The bearer token

- The token is a shared secret the deployer sets in the application's environment as `DEPLOY_REPORT_TOKEN`.
- It MUST be at least **32 characters**. A configured token shorter than that MUST be ignored: the application serves the public tier only and logs a warning.
- It MUST be accepted only in the `Authorization: Bearer <token>` request header. A token in the URL (query string or path) MUST be ignored.
- It MUST be compared in constant time (`hash_equals`, `crypto.timingSafeEqual` or equivalent). It MUST NOT be compared with `==`, `===` or a string equality that returns early.
- A missing or wrong token MUST NOT produce an error response: the application serves the public tier, with the same HTTP status the public tier would have.
- No token configured means the public tier only. Detail is opt-in.

### Committed `tier: full`

An application MAY serve the full tier to every request by setting `tier: full` in its **committed** report configuration (the implementation's configuration file in the repository). This exists for reference apps ("doubles"), which are throwaway applications and serve as the public proof that implementations never leak.

- The tier setting MUST NOT be read from an environment variable or any other value a hosting platform could set by accident.
- Production applications SHOULD NOT set `tier: full`.
- Everything in [never include](#never-include) applies to the full tier, always.

## Never include

No tier of the report, in any field, may contain:

- exception or error message text, stack traces, or driver error strings;
- hostnames or domain names of backing services;
- IP addresses;
- usernames or account names;
- file system paths;
- connection strings or DSNs;
- values of environment variables (variable **names** are allowed in the full tier);
- the bearer token or the run ID.

To make this hold by construction:

- `observed` comes from a fixed format (`engine` or `engine major.minor`), never a raw server banner.
- Errors map to a fixed `code`, with a fixed `hint`, chosen by the error's type and, for database errors, its SQLSTATE or driver error number. Implementations MUST NOT read an error's message into any field, and MUST NOT walk nested errors for text.
- `detail` is produced from fixed templates whose only variable parts are counts, check names, environment variable names and engine names.

## The run ID

The verifier sends the run ID in the request header `Deploy-Run-Id`. The application compares it with `DEPLOY_RUN_ID` in constant time and answers `release.run_id_match` as `true`, `false` or `null`. The value itself MUST NOT appear in any response, log line produced by the implementation, or error.

## The endpoint only reads

A request to the report MUST only read stored results. It MUST NOT run a check, dispatch work, or write to any service it checks, so that request volume can never turn into load on the database, cache or queue. Checks run on the application's schedule. See [report → scheduled checks](report.md#scheduled-checks-stored-results).

## Not a liveness probe

The report MUST NOT be used as a liveness or readiness probe. See [report → endpoints](report.md#endpoints).
