/**
 * Error utility helpers — safe error property access without `catch (e: any)`.
 */

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (typeof e === 'number' || typeof e === 'boolean') return String(e);
  return JSON.stringify(e);
}

export function toStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}

export function errorStack(e: unknown): string | undefined {
  if (e instanceof Error) return e.stack;
  return undefined;
}

export function errorCode(e: unknown): string | undefined {
  if (e instanceof Error && 'code' in e) return (e as NodeJS.ErrnoException).code;
  return undefined;
}
