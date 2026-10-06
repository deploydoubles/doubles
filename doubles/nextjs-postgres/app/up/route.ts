// The process is up. Says nothing about the deploy: that is /.well-known/deploy-report.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response('ok\n', { headers: { 'content-type': 'text/plain' } });
}
