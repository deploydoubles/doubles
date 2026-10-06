# AGENTS.md — symfony-postgres-worker

This repository is a deploy double: a test app whose only job is to be deployed and to report whether the deploy works. Do not add features to it.

## The loop

1. **Read `double.json`.** It lists what to provision: a Postgres database, three processes (web, a Messenger worker `php bin/console messenger:consume async`, and `php bin/console deploy-report:run` every minute from cron), the environment variables (`APP_SECRET` must be generated), the build step and the release step (`php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration`). `persistent_paths` names the directories that must survive every deploy.
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
   | `2` | Still pending at the timeout | Usually a worker or cron job that is not running; read the pending checks |
   | `3` | Unreachable, wrong release, or run ID mismatch | Check the URL, that the release switched, and that environment variables reach the app |

6. **Tear down** what you provisioned.

## Facts an agent needs

- `var/deploy-report/` and `var/storage/` (`persistent_paths` in `double.json`) hold the report's result store and the storage marker, and must be shared between releases. Set them up as the platform's persistent or shared storage — for example persistent paths in Strackt's Runtime settings, or `shared_dirs` in Deployer. Without that, each deploy starts with an empty store: the persistence check finds earlier releases' markers gone, and a rollback looks like a fresh release.
- The report is at `/.well-known/deploy-report`; `/up` returns 200 when the process is alive.
- Checks run once a minute from cron and are stored in `var/deploy-report/`. `var/deploy-report/` and `var/storage/` must be shared by the web process, the worker and the cron job. Allow at least two minutes after the deploy before expecting a settled report.
- The Messenger transport is Doctrine on the same Postgres database (`MESSENGER_TRANSPORT_DSN`, default `doctrine://default?auto_setup=0`); its table is created by the migration.
- The database is read from `DATABASE_URL`, or from `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME` and `DB_PASSWORD` when `DATABASE_URL` is empty.
- No `.env` is committed: a platform's own `.env` (or real environment variables) configure the app; `.env.dist` holds only `APP_ENV=prod`.
- Without a worker, `queue` turns `fail` about two minutes after the first probe. Without the cron job, the report shows only `scheduler: fail`.
