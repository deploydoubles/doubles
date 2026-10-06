import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const NAME = /^[a-z0-9][a-z0-9._-]*$/;

/** A marker file that exists but stays unreadable this long is treated as lost. */
const PARTIAL_WRITE_GRACE = 5;

/** Creates a hard link; throws when it cannot. */
export type Link = (target: string, path: string) => void;

/**
 * The result store: a few small JSON files in the app's persistent storage.
 * Every write goes to a temporary file first and is renamed into place, so a
 * reader never sees a half-written file. The same layout as checks-php.
 */
export class FileStore {
  /**
   * @param link creates a hard link; replaceable so the fallback for
   *        filesystems without hard links can be tested
   */
  constructor(
    readonly directory: string,
    private readonly link: Link = linkSync,
  ) {}

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

  /**
   * Creates the file only when it does not exist yet, atomically: the first
   * writer wins. Returns the stored data, or null when nothing could be
   * stored (an unwritable store), so the caller can say so instead of trying
   * again on every request.
   */
  createIfAbsent(name: string, data: Record<string, unknown>): Record<string, unknown> | null {
    const existing = this.read(name);
    if (existing !== null) return existing;

    const path = this.path(name);
    try {
      this.ensureDirectory();
      const json = JSON.stringify(data);
      const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      writeFileSync(temp, json);
      let linked = true;
      try {
        // link() fails when the target exists, so the first writer wins atomically.
        this.link(temp, path);
      } catch {
        linked = false;
      }
      try {
        unlinkSync(temp);
      } catch {
        // already gone
      }
      if (!linked && !existsSync(path)) {
        // No hard links on this filesystem: an exclusive create is just as
        // first-writer-wins, only not atomic for readers.
        createExclusive(path, json);
      }
    } catch {
      // Nothing could be stored; the read below says so.
    }

    const stored = this.read(name);
    if (stored !== null) return stored;

    // Another writer may be half-way through an exclusive create.
    const age = this.age(name, Math.floor(Date.now() / 1000));
    return age !== null && age <= PARTIAL_WRITE_GRACE ? data : null;
  }

  /** Seconds since the file was last written, or null when it does not exist. */
  age(name: string, now: number): number | null {
    try {
      return now - Math.floor(statSync(this.path(name)).mtimeMs / 1000);
    } catch {
      return null;
    }
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

function createExclusive(path: string, json: string): void {
  let fd: number;
  try {
    fd = openSync(path, 'wx');
  } catch {
    return;
  }
  try {
    writeSync(fd, json);
  } catch {
    // an unfinished marker reads as lost once the grace period has passed
  } finally {
    closeSync(fd);
  }
}

/** Names of the files in the store, keyed by release commit. */
export const Store = {
  key: (commit: string | null): string => commit ?? 'unknown',
  results: (commit: string | null): string => `results-${commit ?? 'unknown'}`,
  heartbeat: (commit: string | null): string => `heartbeat-${commit ?? 'unknown'}`,
  boot: (commit: string | null): string => `boot-${commit ?? 'unknown'}`,
  probePrefix: (commit: string | null): string => `probe-${commit ?? 'unknown'}-`,
  probe: (commit: string | null, id: string): string => `probe-${commit ?? 'unknown'}-${id}`,
};
