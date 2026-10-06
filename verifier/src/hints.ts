/** Fixed, platform-neutral hints for outside checks. */
export const HINTS = {
  unreachable:
    'No deploy report was served at /.well-known/deploy-report. Check that the app is running, that the URL routes to it, and that /.well-known/ paths reach the app.',
  tls: 'The TLS certificate is not valid for this host. Check that a certificate was issued and is served for this domain.',
  httpsRedirect: 'Plain HTTP does not redirect to HTTPS. Configure a permanent redirect from http:// to https://.',
  wrongRelease:
    'A different release is answering than the one deployed. Check that the deploy switched releases and that the previous release is no longer served.',
  unknownRelease:
    'The report did not say which release is answering. Pass --token to read the full report, or let the app resolve its commit (a platform variable, a REVISION file or the .git directory).',
  runId: "The app did not see this deploy's DEPLOY_RUN_ID. Check that environment variables reach the running release.",
  downtime: 'Requests failed while the release switched. Check that the new release is ready before traffic moves to it.',
  pending:
    "The check was still pending when the timeout passed. Use a longer --timeout, or check that the app's scheduler and workers are running.",
  publicTier: 'The report is in its public tier, so it gives no reason. Pass --token to see the hint.',
} as const;
