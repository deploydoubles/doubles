import { describe, expect, it } from 'vitest';
import { makeConfig } from '../src/config.js';
import { decideTier, runIdMatch } from '../src/tier.js';
import { TOKEN } from './helpers.js';

const env = (vars: Record<string, string>) => (name: string) => vars[name] ?? null;

describe('decideTier', () => {
  it('serves the public tier without a token', () => {
    expect(decideTier(makeConfig('/app', {}, env({ DEPLOY_REPORT_TOKEN: TOKEN })), null)).toBe('public');
  });

  it('serves the public tier for a wrong token of valid length', () => {
    const config = makeConfig('/app', {}, env({ DEPLOY_REPORT_TOKEN: TOKEN }));
    expect(decideTier(config, `Bearer ${'x'.repeat(TOKEN.length)}`)).toBe('public');
  });

  it('serves the full tier for the valid token, in the Authorization header only', () => {
    const config = makeConfig('/app', {}, env({ DEPLOY_REPORT_TOKEN: TOKEN }));
    expect(decideTier(config, `Bearer ${TOKEN}`)).toBe('full');
    expect(decideTier(config, TOKEN)).toBe('public');
  });

  it('ignores a token shorter than 32 characters', () => {
    const config = makeConfig('/app', {}, env({ DEPLOY_REPORT_TOKEN: 'short' }));
    expect(decideTier(config, 'Bearer short')).toBe('public');
  });

  it('serves the full tier without a token when the committed config says so', () => {
    expect(decideTier(makeConfig('/app', { tier: 'full' }, env({})), null)).toBe('full');
  });

  it('gives DEPLOY_REPORT_TIER-style variables no effect', () => {
    const config = makeConfig('/app', {}, env({ DEPLOY_REPORT_TIER: 'full', DEPLOY_REPORT_FULL: '1', TIER: 'full' }));
    expect(config.tier).toBe('public');
    expect(decideTier(config, null)).toBe('public');
  });
});

describe('runIdMatch', () => {
  it('answers true, false or null and never the value', () => {
    expect(runIdMatch('run-1', 'run-1')).toBe(true);
    expect(runIdMatch('run-1', 'run-2')).toBe(false);
    expect(runIdMatch(null, 'run-1')).toBeNull();
    expect(runIdMatch('run-1', null)).toBeNull();
  });

  it('ignores surrounding whitespace on both sides', () => {
    expect(runIdMatch('run-123\n', ' run-123 ')).toBe(true);
    expect(runIdMatch('  ', 'run-123')).toBeNull();
    expect(runIdMatch('run-123', '\t')).toBeNull();
  });
});
