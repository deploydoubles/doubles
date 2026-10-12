import { doubleFailure } from '../lib/double-failure';

// Rendered per request, so a deliberate failure is decided at run time.
export const dynamic = 'force-dynamic';

export default function Home() {
  // Deliberate failure (spec/failure-modes.md): "/" only, so the deploy
  // report and /up keep answering and can say what is wrong.
  if (doubleFailure('500')) {
    throw new Error('Deliberate failure: DOUBLE_FAIL=500.');
  }

  return (
    <main>
      <p>
        nextjs-postgres — a deploy double. Its deploy report is at <a href="/.well-known/deploy-report">/.well-known/deploy-report</a>.
      </p>
    </main>
  );
}
