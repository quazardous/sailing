/**
 * Error utility helpers — safe error property access without `catch (e: any)`.
 */

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function errorStack(e: unknown): string | undefined {
  if (e instanceof Error) return e.stack;
  return undefined;
}

export function errorCode(e: unknown): string | undefined {
  if (e instanceof Error && 'code' in e) return (e as NodeJS.ErrnoException).code;
  return undefined;
}
