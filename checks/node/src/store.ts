import { randomBytes } from 'node:crypto';
import { linkSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * The result store: a few small JSON files in the app's persistent storage.
 * Every write goes to a temporary file first and is renamed into place, so a
 * reader never sees a half-written file. The same layout as checks-php.
 */
export class FileStore {
  constructor(readonly directory: string) {}

  write(name: string, data: object): void {
    this.ensureDirectory();
    const path = this.path(name);
    const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(data));
      renameSync(temp, path);
    } catch {
      try {
        unlinkSync(temp);
      } catch {
        // already gone
      }
      throw new Error('deploy-report store write failed');
    }
  }

  /** Creates the file only when it does not exist yet; the first writer wins. Returns the stored data. */
  createIfAbsent(name: string, data: Record<string, unknown>): Record<string, unknown> {
    const existing = this.read(name);
    if (existing !== null) return existing;
    try {
      this.ensureDirectory();
      const path = this.path(name);
      const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      writeFileSync(temp, JSON.stringify(data));
      try {
        linkSync(temp, path);
      } catch {
        // another process created it first
      }
      unlinkSync(temp);
    } catch {
      // A read-only store degrades to "no marker": callers treat that as unknown.
    }
    return this.read(name) ?? data;
  }

  read(name: string): Record<string, unknown> | null {
    let raw: string;
    try {
      raw = readFileSync(this.path(name), 'utf8');
    } catch {
      return null;
    }
    if (raw === '') return null;
    try {
      const data: unknown = JSON.parse(raw);
      return data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  /** File names (without directory and extension) that start with `prefix`, sorted. */
  names(prefix: string): string[] {
    let entries: string[];
    try {
      entries = readdirSync(this.directory);
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.startsWith(prefix) && entry.endsWith('.json'))
      .map((entry) => entry.slice(0, -5))
      .sort();
  }

  delete(name: string): void {
    try {
      unlinkSync(this.path(name));
    } catch {
      // already gone
    }
  }

  private path(name: string): string {
    if (!NAME.test(name)) throw new Error('invalid deploy-report store name');
    return join(this.directory, `${name}.json`);
  }

  private ensureDirectory(): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o775 });
  }
}

/** Names of the files in the store, keyed by release commit. */
export const Store = {
  key: (commit: string | null): string => commit ?? 'unknown',
  results: (commit: string | null): string => `results-${commit ?? 'unknown'}`,
  heartbeat: (commit: string | null): string => `heartbeat-${commit ?? 'unknown'}`,
  boot: (commit: string | null): string => `boot-${commit ?? 'unknown'}`,
};
