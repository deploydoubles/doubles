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

export type Fetch = typeof globalThis.fetch;

export type SameOriginFetch =
  | { kind: 'response'; response: Response }
  /** A redirect to another origin; it was not followed. */
  | { kind: 'cross-origin-redirect'; httpStatus: number }
  /** A redirect without a usable Location, or one hop too many. */
  | { kind: 'bad-redirect'; httpStatus: number };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/**
 * Fetches a URL, following redirects only within the origin it was given, so headers (a token, a
 * run ID) and trust in the response never move to another origin. Network errors throw.
 */
export async function fetchSameOrigin(fetchImpl: Fetch, url: URL, init: Omit<RequestInit, 'redirect'> = {}): Promise<SameOriginFetch> {
  let target = url;
  for (let hop = 0; ; hop++) {
    const response = await fetchImpl(target, { ...init, redirect: 'manual' });
    if (!REDIRECTS.has(response.status)) return { kind: 'response', response };
    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (!location || hop >= MAX_REDIRECTS) return { kind: 'bad-redirect', httpStatus: response.status };
    let next: URL;
    try {
      next = new URL(location, target);
    } catch {
      return { kind: 'bad-redirect', httpStatus: response.status };
    }
    if (next.origin !== url.origin) return { kind: 'cross-origin-redirect', httpStatus: response.status };
    target = next;
  }
}
