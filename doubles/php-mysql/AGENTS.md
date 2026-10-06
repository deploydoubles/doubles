# AGENTS.md — php-mysql

This repository is a deploy double: a test app whose only job is to be deployed and to report whether the deploy works. Do not add features to it.

## The loop

1. **Read `double.json`.** It lists what to provision: a MySQL database, the web process (document root `public/`, front controller `public/index.php`), one cron job (`php vendor/bin/deploy-report-run` every minute, from the app root — see `crontab`), the environment variables (`APP_ENV` must reach the app) and the build step. There is no framework, no queue and no release step. `persistent_paths` names the directories that must survive every deploy.
2. **Provision and deploy** it on the platform you are testing, from this repository's URL. Do not hand the platform `double.json`: the platform must detect what the app needs on its own.
3. **Optionally set `DEPLOY_RUN_ID`** to a fresh value in the app's environment for this deploy.
4. **Verify** once the deploy reports success:

   ```sh
   npx deploydoubles verify <public url> --commit <deployed commit sha> [--run-id <the same value>] --timeout 300 --json
   ```

5. **Act on the exit code.**

   | Exit | Meaning | Do |
   |---|---|---|
   | `0` | Every check passed on the deployed commit | Done |
   | `1` | A check failed | Read each failing check's `hint` in the JSON |
   | `2` | Still pending at the timeout | Usually a cron job that is not running; read the pending checks |
   | `3` | Unreachable, wrong release, or run ID mismatch | Check the URL, that the release switched, and that environment variables reach the app |

6. **Tear down** what you provisioned.

## Facts an agent needs

- `storage/` (`persistent_paths` in `double.json`) holds the report's result store and the storage marker, and must be shared between releases. Set it up as the platform's persistent or shared storage — for example a persistent path in Strackt's Runtime settings, or `shared_dirs` in Deployer. Without that, each deploy starts with an empty store: the persistence check finds earlier releases' markers gone, and a rollback looks like a fresh release.
- The report is at `/.well-known/deploy-report`; `/up` returns 200 when the process is alive. Every path goes through `public/index.php`.
- Checks run once a minute from cron and are stored in `storage/deploy-report/`. `storage/` must be persistent and shared by the web process and the cron job. Allow at least two minutes after the deploy before expecting a settled report.
- The app reads its environment from real variables or, when they are absent, from a `.env` file in the app root — cron jobs usually get no environment, so the cron job depends on that file. `env: fail` from the cron job means the variables never reached it.
- The database is read from `DATABASE_URL` (or `DB_URL`), or from `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME` and `DB_PASSWORD`.
- Without the cron job, the report shows only `scheduler: fail`, about two minutes after the first request.
