/** Reads a non-empty process environment variable. */
export function env(name: string): string | null {
  const value = process.env[name];
  return typeof value === 'string' && value !== '' ? value : null;
}
