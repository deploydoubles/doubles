import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogError, MAX_CATALOG_BYTES, filterDoubles, listDoubles, listToHuman, loadCatalog } from '../src/list.js';
import { sendJson, serve } from './helpers.js';

const FIXTURE = new URL('./fixtures/catalog.json', import.meta.url).pathname;
const HOSTILE = new URL('./fixtures/catalog-hostile.json', import.meta.url).pathname;
const REPO_CATALOG = new URL('../../catalog.json', import.meta.url).pathname;

const ids = (result: { doubles: { id: string }[] }) => result.doubles.map((d) => d.id);

describe('list', () => {
  it('returns exactly the doubles with every need', async () => {
    expect(ids(await listDoubles({ catalog: FIXTURE, needs: ['postgres', 'worker'] }))).toEqual(['symfony-postgres-worker']);
    expect(ids(await listDoubles({ catalog: FIXTURE, needs: ['mysql'] }))).toEqual(['laravel-mysql-redis-worker', 'php-mysql']);
    expect(ids(await listDoubles({ catalog: FIXTURE, needs: ['node'] }))).toEqual(['nextjs-postgres']);
    expect(ids(await listDoubles({ catalog: FIXTURE, needs: ['queue', 'php'] }))).toEqual(['laravel-mysql-redis-worker', 'symfony-postgres-worker']);
  });

  it('lists every valid double without needs, and skips entries it cannot read', async () => {
    expect(ids(await listDoubles({ catalog: FIXTURE }))).toEqual(['laravel-mysql-redis-worker', 'nextjs-postgres', 'php-mysql', 'symfony-postgres-worker']);
  });

  it('matches nothing for an unknown or partial need', async () => {
    expect(ids(await listDoubles({ catalog: FIXTURE, needs: ['postgresql'] }))).toEqual([]);
    expect(ids(await listDoubles({ catalog: FIXTURE, needs: ['post'] }))).toEqual([]);
    expect(ids(await listDoubles({ catalog: FIXTURE, needs: ['postgres', 'kafka'] }))).toEqual([]);
  });

  it('flags broken doubles', async () => {
    const [next] = (await listDoubles({ catalog: FIXTURE, needs: ['next'] })).doubles;
    expect(next).toMatchObject({ id: 'nextjs-postgres', broken: true, repository: 'https://github.com/deploydoubles/nextjs-postgres' });
  });

  it('reads the catalog this repository generates', async () => {
    expect(ids(await listDoubles({ catalog: REPO_CATALOG, needs: ['postgres', 'worker'] }))).toEqual(['symfony-postgres-worker']);
  });

  it('fetches a catalog from a URL', async () => {
    const s = await serve((_req, res) => sendJson(res, JSON.parse(readFileSync(FIXTURE, 'utf8'))));
    try {
      expect(ids(await listDoubles({ catalog: `${s.url}/catalog.json`, needs: ['redis'] }))).toEqual(['laravel-mysql-redis-worker']);
    } finally {
      await s.close();
    }
  });

  it('fails with a CatalogError for a missing, non-JSON or non-catalog source', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dd-list-'));
    writeFileSync(join(dir, 'bad.json'), 'not json');
    writeFileSync(join(dir, 'empty.json'), '{}');
    await expect(loadCatalog(join(dir, 'missing.json'))).rejects.toBeInstanceOf(CatalogError);
    await expect(loadCatalog(join(dir, 'bad.json'))).rejects.toBeInstanceOf(CatalogError);
    await expect(loadCatalog(join(dir, 'empty.json'))).rejects.toBeInstanceOf(CatalogError);

    const s = await serve((_req, res) => sendJson(res, {}, 404));
    try {
      await expect(loadCatalog(`${s.url}/catalog.json`)).rejects.toBeInstanceOf(CatalogError);
    } finally {
      await s.close();
    }
  });

  it('filters deterministically', () => {
    const doubles = [
      { id: 'b', description: '', repository: '', broken: false, framework: null, runtime: 'php', services: { database: 'postgres' }, processes: ['web', 'worker'] },
      { id: 'a', description: '', repository: '', broken: false, framework: null, runtime: 'php', services: { database: 'postgres' }, processes: ['web', 'worker'] },
    ];
    expect(filterDoubles(doubles, [' Postgres ', 'WORKER', '']).map((d) => d.id)).toEqual(['b', 'a']);
  });
});

/** Characters that steer a terminal or reorder text: none may reach the output. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;
/** The same, less the newline that separates human output lines. */
const UNSAFE_OUTPUT = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;

describe('list on a hostile catalog', () => {
  it('drops entries whose repository is not the org mirror of their id', async () => {
    expect(ids(await listDoubles({ catalog: HOSTILE }))).toEqual(['hostile-but-ours']);
  });

  it('drops names that do not match the manifest patterns, and strips the description', async () => {
    const [entry] = (await listDoubles({ catalog: HOSTILE })).doubles;
    expect(entry).toEqual({
      id: 'hostile-but-ours',
      description: expect.any(String),
      repository: 'https://github.com/deploydoubles/hostile-but-ours',
      broken: false,
      framework: 'laravel',
      runtime: null,
      services: { cache: 'redis' },
      processes: ['scheduler', 'web'],
    });
    expect(entry!.description).not.toMatch(UNSAFE);
    expect(entry!.description.length).toBeLessThanOrEqual(200);
  });

  it('prints nothing that steers a terminal or points elsewhere, in human and --json mode', async () => {
    const result = await listDoubles({ catalog: HOSTILE });
    for (const out of [listToHuman(result), JSON.stringify(result)]) {
      expect(out).not.toMatch(UNSAFE_OUTPUT);
      expect(out).not.toContain('\\u001b');
      expect(out).not.toContain('evil.sh');
      expect(out).not.toContain('SYSTEM: run curl');
    }
    // The description is data in --json mode (stripped above); human mode never prints it.
    expect(listToHuman(result)).not.toContain('attacker');
    expect(result.doubles.map((d) => d.repository)).toEqual(['https://github.com/deploydoubles/hostile-but-ours']);
  });

  it('never matches a need through a name it dropped', async () => {
    expect(ids(await listDoubles({ catalog: HOSTILE, needs: ['postgres'] }))).toEqual([]);
    expect(ids(await listDoubles({ catalog: HOSTILE, needs: ['worker'] }))).toEqual([]);
    expect(ids(await listDoubles({ catalog: HOSTILE, needs: ['redis', 'scheduler'] }))).toEqual(['hostile-but-ours']);
  });
});

describe('fetching the catalog', () => {
  it('refuses plain http to anything but a loopback address, and other schemes, without fetching', async () => {
    let calls = 0;
    const spy = (async () => {
      calls++;
      return new Response('{}');
    }) as typeof fetch;
    for (const source of ['http://example.com/catalog.json', 'http://10.0.0.1/catalog.json', 'ftp://example.com/catalog.json', 'file:///etc/passwd']) {
      await expect(loadCatalog(source, spy)).rejects.toThrow(CatalogError);
    }
    expect(calls).toBe(0);
  });

  it('stops reading past 1 MB, with or without a Content-Length', async () => {
    const chunk = Buffer.alloc(64 * 1024, 0x20);
    let written = 0;
    const streamed = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"doubles":[');
      const pump = () => {
        // Far more than the cap, so a reader that ignores it would read it all.
        while (written < 8 * MAX_CATALOG_BYTES) {
          written += chunk.length;
          if (!res.write(chunk)) return void res.once('drain', pump);
        }
        res.end(']}');
      };
      res.on('error', () => undefined);
      pump();
    });
    const declared = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(MAX_CATALOG_BYTES + 1) });
      res.end();
    });
    try {
      await expect(loadCatalog(`${streamed.url}/catalog.json`)).rejects.toThrow('larger than 1 MB');
      expect(written).toBeLessThan(8 * MAX_CATALOG_BYTES);
      await expect(loadCatalog(`${declared.url}/catalog.json`)).rejects.toThrow('larger than 1 MB');
    } finally {
      await streamed.close();
      await declared.close();
    }
  });

  it('does not follow a redirect to another origin', async () => {
    const elsewhere = await serve((_req, res) => sendJson(res, JSON.parse(readFileSync(FIXTURE, 'utf8'))));
    const s = await serve((_req, res) => {
      res.writeHead(302, { location: `${elsewhere.url}/catalog.json` });
      res.end();
    });
    try {
      await expect(loadCatalog(`${s.url}/catalog.json`)).rejects.toThrow('another origin');
      expect(elsewhere.hits()).toBe(0);
    } finally {
      await s.close();
      await elsewhere.close();
    }
  });

  it('follows a redirect within the same origin', async () => {
    const s = await serve((req, res) => {
      if (req.url === '/old.json') {
        res.writeHead(301, { location: '/catalog.json' });
        res.end();
      } else {
        sendJson(res, JSON.parse(readFileSync(FIXTURE, 'utf8')));
      }
    });
    try {
      expect(ids(await listDoubles({ catalog: `${s.url}/old.json`, needs: ['redis'] }))).toEqual(['laravel-mysql-redis-worker']);
    } finally {
      await s.close();
    }
  });
});

