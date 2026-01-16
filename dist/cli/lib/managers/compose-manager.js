/**
 * Compose Manager
 *
 * Business logic for context/prompt composition.
 * Handles config access and orchestrates lib/compose.ts functions.
 */
import { getAgentConfig } from '../../managers/core-manager.js';
import { loadWorkflowsConfig, loadFragment, loadProjectFile, composeContextCore, buildPromptCore, resolveInject as resolveInjectCore } from '../compose.js';
// Re-export pure functions (no config needed)
export { loadWorkflowsConfig, loadFragment, loadProjectFile };
// ============================================================================
// Config Helpers
// ============================================================================
/**
 * Get execution mode from config
 */
export function getExecMode() {
    const config = getAgentConfig();
    return config.use_subprocess ? 'subprocess' : 'inline';
}
/**
 * Get agent config values needed for compose
 */
function getComposeConfig() {
    const config = getAgentConfig();
    return {
        useWorktrees: config.use_worktrees ?? true,
        useSubprocess: config.use_subprocess ?? false,
        sandbox: config.sandbox ?? false
    };
}
// ============================================================================
// Public API
// ============================================================================
/**
 * Compose context for an operation
 * Main entry point for context composition
 */
export function composeContext(options) {
    const config = getComposeConfig();
    const mode = options.mode || (config.useSubprocess ? 'subprocess' : 'inline');
    return composeContextCore({
        ...options,
        mode,
        useWorktrees: config.useWorktrees
    });
}
/**
 * Compose agent context for agent:spawn
 * Convenience wrapper with agent role preset
 */
export function composeAgentContext(operation, debug = false) {
    const result = composeContext({
        operation,
        role: 'agent',
        debug
    });
    return result || { content: '', sources: [], role: 'agent', operation };
}
/**
 * Build complete agent spawn prompt for a task
 */
export function buildAgentSpawnPrompt(taskId, options = {}) {
    const config = getComposeConfig();
    const useWorktree = options.useWorktree ?? config.useWorktrees;
    return buildPromptCore(taskId, {
        useWorktree,
        sandbox: config.sandbox
    });
}
/**
 * Resolve inject configuration for a role and mode
 * (wrapper that passes config)
 */
export function resolveInject(roleDef, mode) {
    const config = getComposeConfig();
    return resolveInjectCore(roleDef, mode, config.useWorktrees);
}
