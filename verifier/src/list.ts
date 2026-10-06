import { readFile, stat } from 'node:fs/promises';
import { printable } from './hints.js';
import { fetchSameOrigin, isLoopbackHost, type Fetch } from './net.js';

/** Where `list` reads the catalog when no --catalog is given (raw GitHub may serve it up to ~5 minutes stale). */
export const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/deploydoubles/doubles/main/catalog.json';

const FETCH_TIMEOUT_MS = 15_000;

/** A catalog is a few kilobytes; anything past this is not one, and is not read further. */
export const MAX_CATALOG_BYTES = 1024 * 1024;

const ORG_REPOSITORY = 'https://github.com/deploydoubles/';
/** The manifest schema's name pattern (spec/schema/manifest-v0.1.json, `component.name`). */
const NAME = /^[a-z0-9-]{1,64}$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DESCRIPTION_MAX = 200;

export interface ListedDouble {
  id: string;
  description: string;
  repository: string;
  broken: boolean;
  framework: string | null;
  runtime: string | null;
  services: Record<string, string>;
  processes: string[];
}

export interface ListResult {
  doubles: ListedDouble[];
}

export class CatalogError extends Error {}

/**
 * Reads the catalog from a local path or a URL. Any failure — not found, not JSON, not a catalog,
 * too large, a plain-http or cross-origin source — is a CatalogError with a fixed message.
 *
 * The catalog is remote input: only https:// is fetched (http:// on a loopback address), redirects
 * are followed within the origin only, the body is read up to 1 MB, and every entry is checked
 * before anything from it is printed (see toListed).
 */
export async function loadCatalog(source: string, fetchImpl: Fetch = globalThis.fetch): Promise<ListedDouble[]> {
  const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(source) ? await fetchCatalog(source, fetchImpl) : await readLocal(source);

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new CatalogError('the catalog is not valid JSON');
  }
  const entries = (data as { doubles?: unknown } | null)?.doubles;
  if (!Array.isArray(entries)) throw new CatalogError('the catalog has no "doubles" list');

  return entries.map(toListed).filter((entry): entry is ListedDouble => entry !== null);
}

async function fetchCatalog(source: string, fetchImpl: Fetch): Promise<string> {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new CatalogError('the catalog URL is not a valid URL');
  }
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname)))) {
    throw new CatalogError('the catalog URL must use https:// (http:// only on a loopback address)');
  }

  const abort = new AbortController();
  try {
    const fetched = await fetchSameOrigin(fetchImpl, url, { signal: AbortSignal.any([AbortSignal.timeout(FETCH_TIMEOUT_MS), abort.signal]) });
    if (fetched.kind === 'cross-origin-redirect') throw new CatalogError('the catalog URL redirected to another origin, which is not followed');
    if (fetched.kind === 'bad-redirect') throw new CatalogError(`the catalog could not be fetched (HTTP ${fetched.httpStatus})`);
    const { response } = fetched;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new CatalogError(`the catalog could not be fetched (HTTP ${response.status})`);
    }
    return await readCapped(response, abort);
  } catch (error) {
    throw error instanceof CatalogError ? error : new CatalogError('the catalog could not be read');
  } finally {
    abort.abort();
  }
}

/** The body as text, streamed and abandoned as soon as it passes MAX_CATALOG_BYTES. */
async function readCapped(response: Response, abort: AbortController): Promise<string> {
  const tooLarge = () => new CatalogError('the catalog is larger than 1 MB');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_CATALOG_BYTES) {
    abort.abort();
    throw tooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_CATALOG_BYTES) {
      abort.abort();
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readLocal(path: string): Promise<string> {
  try {
    if ((await stat(path)).size > MAX_CATALOG_BYTES) throw new CatalogError('the catalog is larger than 1 MB');
    return await readFile(path, 'utf8');
  } catch (error) {
    throw error instanceof CatalogError ? error : new CatalogError('the catalog could not be read');
  }
}

/**
 * Doubles that have every need. A need is a name used verbatim in the
 * manifest: a service (`postgres`, `redis`), a service kind (`database`,
 * `cache`, `queue`), a process (`worker`, `scheduler`), the runtime (`php`,
 * `node`) or the framework (`laravel`). Unknown needs match nothing.
 */
export function filterDoubles(doubles: ListedDouble[], needs: string[]): ListedDouble[] {
  const wanted = needs.map((need) => need.trim().toLowerCase()).filter((need) => need !== '');
  return doubles.filter((double) => {
    const has = vocabulary(double);
    return wanted.every((need) => has.has(need));
  });
}

export function vocabulary(double: ListedDouble): Set<string> {
  const words = new Set<string>();
  for (const [kind, service] of Object.entries(double.services)) {
    words.add(kind);
    words.add(service);
  }
  for (const process of double.processes) words.add(process);
  if (double.runtime) words.add(double.runtime);
  if (double.framework) words.add(double.framework);
  return words;
}

export async function listDoubles(options: { catalog?: string; needs?: string[] } = {}, fetchImpl?: Fetch): Promise<ListResult> {
  const doubles = await loadCatalog(options.catalog ?? DEFAULT_CATALOG_URL, fetchImpl);
  return { doubles: filterDoubles(doubles, options.needs ?? []) };
}

export function listToHuman(result: ListResult): string {
  if (result.doubles.length === 0) return 'No double has everything you need.';
  const width = Math.max(...result.doubles.map((d) => d.id.length));
  return result.doubles
    .map((d) => {
      const needs = [...new Set([...Object.values(d.services), ...d.processes.filter((p) => p !== 'web')])].join(', ');
      return `${d.id.padEnd(width)}  ${needs || '-'}${d.broken ? '  (broken: failing its own nightly run)' : ''}\n${' '.repeat(width)}  ${d.repository}`;
    })
    .join('\n');
}

/**
 * One catalog entry, or null when it cannot be trusted. Every string that survives is printable:
 * the id, names and repository must match fixed patterns, and the description has control,
 * bidirectional and zero-width characters removed. A name that does not match is dropped.
 */
function toListed(entry: unknown): ListedDouble | null {
  if (entry === null || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id.length > 64 || !ID.test(e.id)) return null;
  // Only the org's own read-only mirror: a catalog cannot point an agent at another repository.
  if (e.repository !== ORG_REPOSITORY + e.id) return null;

  const services: Record<string, string> = {};
  if (e.services !== null && typeof e.services === 'object' && !Array.isArray(e.services)) {
    for (const [kind, value] of Object.entries(e.services as Record<string, unknown>)) {
      if (NAME.test(kind) && typeof value === 'string' && NAME.test(value)) services[kind] = value;
    }
  }
  const processes =
    e.processes !== null && typeof e.processes === 'object' && !Array.isArray(e.processes)
      ? Object.keys(e.processes as object).filter((key) => NAME.test(key)).sort()
      : [];

  return {
    id: e.id,
    description: typeof e.description === 'string' ? printable(e.description).slice(0, DESCRIPTION_MAX) : '',
    repository: ORG_REPOSITORY + e.id,
    broken: e.broken === true,
    framework: name(e.framework),
    runtime: name(e.runtime),
    services,
    processes,
  };
}

function name(component: unknown): string | null {
  const value = (component as { name?: unknown } | null)?.name;
  return typeof value === 'string' && NAME.test(value) ? value : null;
}
