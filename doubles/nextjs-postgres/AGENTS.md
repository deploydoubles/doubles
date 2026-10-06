# AGENTS.md — nextjs-postgres

This repository is a deploy double: a test app whose only job is to be deployed and to report whether the deploy works. Do not add features to it.

## The loop

1. **Read `double.json`.** It lists what to provision: a Postgres database and one process (`npm start`, which serves on `$PORT`). There is no worker and no cron job: the checks run inside the web process. The build is `npm ci` then `npm run build`; there is no release step. `persistent_paths` names the directories that must survive every deploy.
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
   | `2` | Still pending at the timeout | The server's in-process scheduler has not run yet; read the pending checks |
   | `3` | Unreachable, wrong release, or run ID mismatch | Check the URL, that the release switched, and that environment variables reach the app |

6. **Tear down** what you provisioned.

## Facts an agent needs

- `storage/` (`persistent_paths` in `double.json`) holds the report's result store and the storage marker, and must be shared between releases. Set it up as the platform's persistent or shared storage — for example a persistent path in Strackt's Runtime settings, or `shared_dirs` in Deployer. Without that, each deploy starts with an empty store: the persistence check finds earlier releases' markers gone, and a rollback looks like a fresh release.
- The report is at `/.well-known/deploy-report`; `/up` returns 200 when the process is alive.
- Checks run in the server process, started from `instrumentation.ts`: once at boot, then every 60 seconds. Results are stored in `storage/deploy-report/`.
- The database is read from `DATABASE_URL`, or from the libpq variables `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` and `PGPASSWORD` when `DATABASE_URL` is unset.
- This is a Node app only: no PHP, no `composer.json`. A platform that asks for PHP has misdetected it.
