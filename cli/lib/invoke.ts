/**
 * Self-invocation utilities for rudder CLI
 *
 * Handles dev mode (tsx) vs dist mode (node) transparently
 * for internal execSync calls (assign:claim, agent:reap, etc.)
 */
import { execSync, ExecSyncOptions } from 'child_process';

/**
 * Detect if running in dev mode (TypeScript via tsx)
 */
export function isDevMode(): boolean {
  return process.argv[1]?.endsWith('.ts') ?? false;
}

/**
 * Get the command prefix to invoke rudder
 * - Dev mode: npx tsx /path/to/rudder.ts
 * - Dist mode: node /path/to/rudder.js
 */
export function getRudderCommand(): string {
  const script = process.argv[1];
  if (isDevMode()) {
    return `npx tsx ${script}`;
  }
  return `${process.argv[0]} ${script}`;
}

/**
 * Execute a rudder command synchronously
 * Automatically uses correct invocation for dev/dist mode
 *
 * @param args - Command arguments (e.g., "assign:claim T001 --json")
 * @param options - execSync options (cwd, encoding, etc.)
 * @returns Command output as string
 */
export function execRudder(args: string, options?: ExecSyncOptions): string {
  const cmd = `${getRudderCommand()} ${args}`;
  return execSync(cmd, {
    encoding: 'utf8',
    ...options
  }) as string;
}

/**
 * Execute a rudder command with captured stderr
 * Returns { stdout, stderr } instead of throwing on non-zero exit
 *
 * @param args - Command arguments
 * @param options - execSync options
 * @returns { stdout, stderr, exitCode }
 */
export function execRudderSafe(args: string, options?: ExecSyncOptions): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const cmd = `${getRudderCommand()} ${args}`;
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options
    }) as string;
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() || '',
      stderr: e.stderr?.toString() || '',
      exitCode: e.status ?? 1
    };
  }
}
