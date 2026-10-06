# The manifest (`double.json`) — v0.1 (draft)

**Status**: draft, v0.x. **Schema**: [`schema/manifest-v0.1.json`](schema/manifest-v0.1.json) (JSON Schema 2020-12).

The key words MUST, MUST NOT, SHOULD and MAY are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

A manifest says what an application needs and which checks must pass once it is deployed. Every reference app ("double") ships one at its root as `double.json`. It is modelled on Heroku's `app.json` (add-ons, formation, env, post-deploy scripts) and Score (typed, platform-neutral resources), but it is its own small schema, because neither can say which checks must pass.

**A platform MUST NOT read the manifest to configure an application.** The manifest is what the platform is tested against: a platform that reads it can no longer be tested on what it detects. See [outside checks → detection](outside-checks.md#detection).

## Fields

| Field | Required | Meaning |
|---|---|---|
| `spec_version` | yes | `"0.1"` |
| `id` | yes | The double's id: `<framework>[-<database>][-<cache>][-worker]`, lowercase, hyphenated |
| `description` | yes | One sentence |
| `framework` | yes | `{ "name": "laravel", "version": "^12.0" }` — name and a version constraint |
| `runtime` | yes | `{ "name": "php", "version": ">=8.3" }` — name and a version constraint |
| `services` | yes | Backing services, by kind — see below. `{}` when none |
| `processes` | yes | `web` (required), `worker`, `scheduler` — each `{ "command": "<exact command>" }` |
| `env` | yes | `required`: variable names that must be present; `generated`: those a platform must generate (e.g. `APP_KEY`) |
| `build` | no | Commands that build the app, in order |
| `release` | no | Commands that run once per release before it serves (e.g. migrations) |
| `expects` | yes | `inside`: inside check names that must pass; `outside`: outside check names that must pass |
| `failure_modes` | no | Deliberate failures the double can produce (reserved; empty in v0.1) |

### `services`

| Key | Values |
|---|---|
| `database` | `mysql`, `mariadb`, `postgres`, `sqlite` |
| `cache` | `redis`, `valkey` |
| `queue` | `redis`, `valkey`, `database` |

A key that is absent means the app does not use that kind of service.

### Connection settings

A double MUST accept both connection styles for every service it uses: a URL (`DATABASE_URL`, `REDIS_URL`) and the framework's discrete variables (`DB_HOST`, `DB_PORT`, …). This keeps doubles deployable on any platform. Variables a platform provides for connections SHOULD NOT be listed in `env.required`, because which of the two styles a platform uses is its own choice.

### Process commands

`processes.<name>.command` is the exact command a platform should run, with no shell wrapper — for example `php artisan queue:work` or `php bin/console messenger:consume async`. `web` describes how the app serves HTTP when no platform web server is used.

## Example

[`examples/double-laravel-mysql-redis-worker.json`](examples/double-laravel-mysql-redis-worker.json).
