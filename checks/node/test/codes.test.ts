import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HINTS } from '../src/codes.js';

// checks-php's Codes.php, when this runs in the monorepo. The read-only split has no PHP to compare with.
const codesPhp = new URL('../../php/src/Codes.php', import.meta.url).pathname;

describe('codes and hints', () => {
  it.skipIf(!existsSync(codesPhp))('has exactly the codes of checks-php, with byte-identical hints', () => {
    const script = `require ${JSON.stringify(codesPhp)}; $out = []; foreach (DeployDoubles\\Checks\\Codes::all() as $code) { $out[$code] = DeployDoubles\\Checks\\Codes::hint($code); } echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);`;
    const php: Record<string, string> = JSON.parse(execFileSync('php', ['-r', script], { encoding: 'utf8' }));

    expect(Object.keys(php).length).toBeGreaterThan(20);
    expect(Object.keys(HINTS).sort()).toEqual(Object.keys(php).sort());
    for (const [code, hint] of Object.entries(php)) expect(HINTS[code as keyof typeof HINTS], code).toBe(hint);
  });
});
