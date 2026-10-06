#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { decideExitCode } from './decide.js';
import { CatalogError, DEFAULT_CATALOG_URL, listDoubles, listToHuman } from './list.js';
import { isLoopbackHost } from './net.js';
import { toHuman, toJson } from './output.js';
import { verify } from './verify.js';

const USAGE = `deploydoubles — verify that a deploy actually works

Usage:
  deploydoubles verify <url> --commit <sha> [options]
  deploydoubles list [--needs <a,b>] [--catalog <path or url>] [--json]

verify options:
  --commit <sha>      the commit you deployed (required)
  --run-id <id>       the DEPLOY_RUN_ID you set for this deploy; checked only when given
  --token <token>     DEPLOY_REPORT_TOKEN, to read the full report (https://, or http:// on loopback only)
  --during-deploy     measure failed requests while the release switches
  --timeout <s>       seconds to wait for the report to settle (default 300)
  --json              print one JSON object, nothing else

list options:
  --needs <a,b>       only doubles with all of these: services (postgres, redis),
                      service kinds (database, queue), processes (worker, scheduler),
                      runtime (php, node) or framework (laravel)
  --catalog <src>     a catalog.json path or URL (default: ${DEFAULT_CATALOG_URL})
  --json              print one JSON object, nothing else

Exit codes:
  0  every check passed on the deployed commit
  1  a check failed
  2  still pending when the timeout passed
  3  unreachable, wrong release, or run ID mismatch
`;

type Exit = 0 | 1 | 2 | 3 | 64;

/** A token over plain http to anything but this machine is readable on the way. */
function sendsTokenInClear(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname);
  } catch {
    return true;
  }
}

async function main(argv: string[]): Promise<Exit> {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return command ? 0 : 64;
  }

  if (command === 'list') {
    let listArgs;
    try {
      listArgs = parseArgs({
        args: rest,
        strict: true,
        options: { json: { type: 'boolean' }, needs: { type: 'string' }, catalog: { type: 'string' } },
      }).values;
    } catch (error) {
      process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
      return 64;
    }
    try {
      const result = await listDoubles({ catalog: listArgs.catalog, needs: listArgs.needs?.split(',') ?? [] });
      process.stdout.write((listArgs.json ? JSON.stringify(result) : listToHuman(result)) + '\n');
      return 0;
    } catch (error) {
      if (!(error instanceof CatalogError)) throw error;
      // Unreachable, like verify's exit 3.
      if (listArgs.json) process.stdout.write(JSON.stringify({ doubles: [], error: error.message }) + '\n');
      else process.stderr.write(`deploydoubles: ${error.message}\n`);
      return 3;
    }
  }

  if (command !== 'verify') {
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
    return 64;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      strict: true,
      options: {
        commit: { type: 'string' },
        'run-id': { type: 'string' },
        token: { type: 'string' },
        'during-deploy': { type: 'boolean' },
        timeout: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
    return 64;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const url = positionals[0];
  const timeout = values.timeout === undefined ? 300 : Number(values.timeout);
  const usageError = !url
    ? 'A URL is required.'
    : !/^https?:\/\//.test(url) || !URL.canParse(url)
      ? 'The URL must be a valid http:// or https:// URL.'
      : !values.commit
        ? '--commit is required.'
        : !/^[0-9a-fA-F]{7,64}$/.test(values.commit)
          ? '--commit must be a hexadecimal commit sha (at least 7 characters).'
          : !Number.isFinite(timeout) || timeout <= 0
            ? '--timeout must be a positive number of seconds.'
            : values.token !== undefined && sendsTokenInClear(url!)
              ? '--token is only sent over https:// (or http:// to a loopback address); plain http would expose it.'
              : null;
  if (usageError) {
    process.stderr.write(`${usageError}\n\n${USAGE}`);
    return 64;
  }

  const result = await verify({
    url: url!,
    commit: values.commit!,
    runId: values['run-id'],
    token: values.token,
    timeoutSeconds: timeout,
    duringDeploy: values['during-deploy'] === true,
  });
  const code = decideExitCode(result);

  process.stdout.write((values.json ? JSON.stringify(toJson(result, code)) : toHuman(result, code)) + '\n');
  return code;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  () => {
    // Never print error objects: they could carry request details.
    process.stderr.write('deploydoubles: unexpected error\n');
    process.exit(3);
  },
);
