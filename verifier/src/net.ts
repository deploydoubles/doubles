const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_REVOKED',
  'CERT_UNTRUSTED',
  'ERR_SSL_WRONG_VERSION_NUMBER',
]);

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

/** TLS and redirect checks apply only to https:// URLs on non-loopback hosts. */
export function appliesTlsChecks(url: URL): boolean {
  return url.protocol === 'https:' && !isLoopbackHost(url.hostname);
}

export function isTlsError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && TLS_ERROR_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function reportUrl(base: string): URL {
  const url = new URL(base);
  url.pathname = url.pathname.replace(/\/+$/, '') + '/.well-known/deploy-report';
  url.search = '';
  url.hash = '';
  return url;
}
