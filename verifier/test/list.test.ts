import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogError, filterDoubles, listDoubles, loadCatalog } from '../src/list.js';
import { sendJson, serve } from './helpers.js';

const FIXTURE = new URL('./fixtures/catalog.json', import.meta.url).pathname;
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
