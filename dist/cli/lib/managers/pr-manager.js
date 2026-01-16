/**
 * PR/MR Manager
 *
 * Business logic for pull request operations.
 * Handles config access and orchestrates lib/git-forge.ts functions.
 */
import { getAgentConfig } from '../../managers/core-manager.js';
import { detectProvider, checkCli, getStatus as getStatusCore, exists, create as createCore, isMerged, getUrlFromState } from '../git-forge.js';
// Re-export pure functions
export { detectProvider, checkCli, exists, isMerged, getUrlFromState };
// ============================================================================
// Config Helpers
// ============================================================================
/**
 * Get configured or auto-detected provider
 */
export async function getProvider(cwd) {
    const config = getAgentConfig();
    if (config.pr_provider && config.pr_provider !== 'auto') {
        return config.pr_provider;
    }
    return detectProvider(cwd);
}
// ============================================================================
// Public API
// ============================================================================
/**
 * Get PR status for a branch
 */
export async function getStatus(branch, cwd, provider) {
    const resolvedProvider = provider || await getProvider(cwd) || undefined;
    return getStatusCore(branch, cwd, resolvedProvider);
}
/**
 * Create PR for a task
 */
export async function create(taskId, options = {}) {
    const cwd = options.cwd || process.cwd();
    const provider = await getProvider(cwd);
    return createCore(taskId, { ...options, provider: provider || undefined });
}
