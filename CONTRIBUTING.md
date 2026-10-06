# Contributing

Thank you for helping. Deploy Doubles is useful only if it stays small, neutral and correct.

## Disclose AI assistance

Much of this project is drafted by AI agents under human review, and we say so openly. We ask the same of contributors: **say in your pull request description whether, and how, AI tools helped write it.** It does not affect whether a change is accepted; it helps reviewers know what to look at. Commits written mostly by an agent should carry a `Co-Authored-By` trailer naming it.

## Proposing a new double

A new double is accepted when it has:

1. **A `docker-compose.yml`** in `doubles/<id>/` that starts the app and every service it needs, built from the repository root like the existing doubles.
2. **A passing conformance run**: `scripts/conformance.sh <id>` exits `0`, and a revert control fails — for example `scripts/conformance.sh <id> --without worker` exits non-zero for a double with a worker. CI runs both on your pull request.
3. **A named maintainer** who will keep it current, listed in the double's `README.md`.

Doubles are named `<framework>[-<database>][-<cache>][-worker]`. We do not build the full framework × service matrix: per framework, a minimal double, a full double, and one variant per service only where the framework handles that service differently.

A double must:

- require the check library by a published version constraint, never a path repository;
- commit its library configuration with `tier: full` (doubles serve the full report publicly);
- accept both URL-style (`DATABASE_URL`, `REDIS_URL`) and discrete (`DB_HOST`, …) connection settings;
- contain nothing specific to one hosting platform.

## Changing the specification

Open an issue first. Explain the deploy failure the change would catch, or the implementer it would unblock. The specification is a draft (v0.x), so breaking changes are possible, but every change must keep the [security rules](spec/security.md) intact.

## Development

| Part | Test command |
|---|---|
| Specification | `npx --yes ajv-cli@5 validate -s spec/schema/report-v0.1.json -d spec/examples/report-full.json --spec=draft2020` |
| `checks/php` | `cd checks/php && composer install && vendor/bin/pest` |
| `verifier` | `cd verifier && npm ci && npm test -- --run` |
| A double | `cd verifier && npm ci && npm run build && cd .. && scripts/conformance.sh <id>` |

Use conventional commit subjects (`feat(verifier): …`, `fix(checks-php): …`).
