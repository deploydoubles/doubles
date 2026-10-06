#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { decideExitCode } from './decide.js';
import { listDoubles } from './list.js';
import { toHuman, toJson } from './output.js';
import { verify } from './verify.js';

const USAGE = `deploydoubles — verify that a deploy actually works

Usage:
  deploydoubles verify <url> --commit <sha> [options]
  deploydoubles list [--json]

verify options:
  --commit <sha>      the commit you deployed (required)
  --run-id <id>       the DEPLOY_RUN_ID you set for this deploy; checked only when given
  --token <token>     DEPLOY_REPORT_TOKEN, to read the full report
  --during-deploy     measure failed requests while the release switches
  --timeout <s>       seconds to wait for the report to settle (default 300)
  --json              print one JSON object, nothing else

Exit codes:
  0  every check passed on the deployed commit
  1  a check failed
  2  still pending when the timeout passed
  3  unreachable, wrong release, or run ID mismatch
`;

type Exit = 0 | 1 | 2 | 3 | 64;

async function main(argv: string[]): Promise<Exit> {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return command ? 0 : 64;
  }

  if (command === 'list') {
    const { values } = parseArgs({ args: rest, options: { json: { type: 'boolean' } }, strict: true });
    const result = listDoubles();
    process.stdout.write(values.json ? JSON.stringify(result) + '\n' : 'No doubles in the catalog yet.\n');
    return 0;
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
    : !/^https?:\/\//.test(url)
      ? 'The URL must start with http:// or https://.'
      : !values.commit
        ? '--commit is required.'
        : !/^[0-9a-fA-F]{7,64}$/.test(values.commit)
          ? '--commit must be a hexadecimal commit sha (at least 7 characters).'
          : !Number.isFinite(timeout) || timeout <= 0
            ? '--timeout must be a positive number of seconds.'
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
