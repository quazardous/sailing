/**
 * Self-invocation utilities for rudder CLI
 *
 * Handles dev mode (tsx) vs dist mode (node) transparently.
 *
 * ⚠️ STRONGLY DISCOURAGED: These functions should ONLY be used when there is
 * NO library alternative. Prefer using lib functions directly:
 *   - Task updates: use loadFile/saveFile from core.ts
 *   - Context generation: use composeAgentContext from compose.ts
 *   - State management: use functions from state.ts, db.ts
 *
 * Only use execRudder/execRudderSafe for complex orchestration where
 * the command has side effects that are hard to replicate (e.g., agent:reap
 * which does cleanup, state updates, and git operations atomically).
 */
import { execaSync } from 'execa';
/**
 * Detect if running in dev mode (TypeScript via tsx)
 */
export function isDevMode() {
    return process.argv[1]?.endsWith('.ts') ?? false;
}
/**
 * Get the command parts to invoke rudder
 * - Dev mode: ['npx', ['tsx', '/path/to/rudder.ts']]
 * - Dist mode: ['node', ['/path/to/rudder.js']]
 */
export function getRudderCommand() {
    const script = process.argv[1];
    if (isDevMode()) {
        return { cmd: 'npx', baseArgs: ['tsx', script] };
    }
    return { cmd: process.argv[0], baseArgs: [script] };
}
/**
 * Execute a rudder command synchronously
 *
 * ⚠️ LAST RESORT ONLY - prefer lib functions. See module docs.
 *
 * @param args - Command arguments (e.g., "agent:reap T001")
 * @param options - execa options (cwd, etc.)
 * @returns Command output as string
 * @deprecated Prefer using lib functions directly when possible
 */
export function execRudder(args, options) {
    const { cmd, baseArgs } = getRudderCommand();
    const allArgs = [...baseArgs, ...args.split(/\s+/)];
    const { stdout } = execaSync(cmd, allArgs, options);
    return String(stdout);
}
/**
 * Execute a rudder command with captured stderr
 *
 * ⚠️ LAST RESORT ONLY - prefer lib functions. See module docs.
 *
 * @param args - Command arguments
 * @param options - execa options
 * @returns { stdout, stderr, exitCode }
 * @deprecated Prefer using lib functions directly when possible
 */
export function execRudderSafe(args, options) {
    const { cmd, baseArgs } = getRudderCommand();
    const allArgs = [...baseArgs, ...args.split(/\s+/)];
    const result = execaSync(cmd, allArgs, { reject: false, ...options });
    return { stdout: String(result.stdout), stderr: String(result.stderr), exitCode: result.exitCode ?? 0 };
}
