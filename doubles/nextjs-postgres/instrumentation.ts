// Starts the deploy report's in-process scheduler when the server boots: one
// run now, then one every 60 s, in this process (no cron, no extra worker).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Deliberate failures (spec/failure-modes.md), on this release's commit only.
  const { doubleFailure } = await import('./lib/double-failure');
  if (doubleFailure('boot')) {
    throw new Error('Deliberate failure: DOUBLE_FAIL=boot fails the server start.');
  }
  if (doubleFailure('slow-boot')) {
    // The server holds requests until register() returns.
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }

  const { startDeployReport } = await import('@deploydoubles/checks');
  const { createClient } = await import('./lib/db');
  startDeployReport({ database: createClient });
}
