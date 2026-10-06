import { readFile } from 'node:fs/promises';

/** Where `list` reads the catalog when no --catalog is given (raw GitHub may serve it up to ~5 minutes stale). */
export const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/deploydoubles/doubles/main/catalog.json';

const FETCH_TIMEOUT_MS = 15_000;

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
 * Reads the catalog from a local path or an http(s) URL. Any failure — not
 * found, not JSON, not a catalog — is a CatalogError with a fixed message.
 */
export async function loadCatalog(source: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<ListedDouble[]> {
  let raw: string;
  try {
    if (/^https?:\/\//i.test(source)) {
      const response = await fetchImpl(source, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
      if (!response.ok) throw new CatalogError(`the catalog could not be fetched (HTTP ${response.status})`);
      raw = await response.text();
    } else {
      raw = await readFile(source, 'utf8');
    }
  } catch (error) {
    throw error instanceof CatalogError ? error : new CatalogError('the catalog could not be read');
  }

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

export async function listDoubles(options: { catalog?: string; needs?: string[] } = {}, fetchImpl?: typeof fetch): Promise<ListResult> {
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

function toListed(entry: unknown): ListedDouble | null {
  if (entry === null || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) return null;

  const services: Record<string, string> = {};
  if (e.services !== null && typeof e.services === 'object') {
    for (const [kind, value] of Object.entries(e.services as Record<string, unknown>)) {
      if (typeof value === 'string') services[kind] = value;
    }
  }
  const processes = e.processes !== null && typeof e.processes === 'object' ? Object.keys(e.processes as object).sort() : [];

  return {
    id: e.id,
    description: typeof e.description === 'string' ? e.description : '',
    repository: typeof e.repository === 'string' ? e.repository : `https://github.com/deploydoubles/${e.id}`,
    broken: e.broken === true,
    framework: name(e.framework),
    runtime: name(e.runtime),
    services,
    processes,
  };
}

function name(component: unknown): string | null {
  const value = (component as { name?: unknown } | null)?.name;
  return typeof value === 'string' ? value : null;
}
