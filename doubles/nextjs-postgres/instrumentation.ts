// Starts the deploy report's in-process scheduler when the server boots: one
// run now, then one every 60 s, in this process (no cron, no extra worker).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startDeployReport } = await import('@deploydoubles/checks');
  const { createClient } = await import('./lib/db');
  startDeployReport({ database: createClient });
}
