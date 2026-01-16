/**
 * Config Manager
 *
 * Semantic accessors for configuration values.
 * Technical operations (load, parse, schema) are in lib/config.ts.
 *
 * This manager provides:
 * - Section accessors: getAgentConfig(), getGitConfig(), getIdsConfig()
 * - Value accessor: getConfigValue()
 * - ID formatting: formatId()
 * - Display: getConfigDisplay()
 * - Validation: validateConfigCoherence()
 */
import { loadConfig, CONFIG_SCHEMA, getNestedValue } from '../../managers/core-manager.js';
/**
 * Get agent configuration section
 */
export function getAgentConfig() {
    const config = loadConfig();
    return config.agent;
}
/**
 * Get git configuration section
 */
export function getGitConfig() {
    const config = loadConfig();
    return config.git;
}
/**
 * Get IDs configuration section
 */
export function getIdsConfig() {
    const config = loadConfig();
    return config.ids;
}
/**
 * Get a specific config value by dot-notation key
 * @param key - Dot-notation key (e.g., 'agent.timeout')
 */
export function getConfigValue(key) {
    const config = loadConfig();
    return getNestedValue(config, key);
}
/**
 * Format an ID with configured digits
 * @param prefix - 'PRD-', 'E', 'T', or 'S'
 * @param num - The numeric part
 * @returns Formatted ID (e.g., 'T001')
 */
export function formatId(prefix, num) {
    const ids = getIdsConfig();
    const digitMap = {
        'PRD-': ids.prd_digits,
        'E': ids.epic_digits,
        'T': ids.task_digits,
        'S': ids.story_digits
    };
    const digits = digitMap[prefix] || 3;
    return `${prefix}${String(num).padStart(digits, '0')}`;
}
/**
 * Validate config coherence (early boot check)
 * use_worktrees is the master config
 *
 * Rules:
 *   1. use_subprocess must equal use_worktrees (master)
 *   2. if use_subprocess=true → sandbox must be true (no subprocess without sandbox yet)
 *   3. if use_subprocess=false → sandbox is ignored
 *
 * @returns Error message if incoherent, null if OK
 */
export function validateConfigCoherence() {
    const config = loadConfig();
    const { use_worktrees, use_subprocess, sandbox } = config.agent;
    const errors = [];
    const fixes = [];
    // Rule 1: use_subprocess must follow use_worktrees
    if (use_worktrees !== use_subprocess) {
        errors.push(`agent.use_subprocess=${use_subprocess} (should be ${use_worktrees})`);
        fixes.push(`rudder config:set agent.use_subprocess ${use_worktrees}`);
    }
    // Rule 2: if subprocess mode, sandbox is required
    if (use_subprocess && !sandbox) {
        errors.push(`agent.sandbox=${sandbox} (must be true when use_subprocess=true)`);
        fixes.push(`rudder config:set agent.sandbox true`);
    }
    if (errors.length > 0) {
        return `agent.use_worktrees=${use_worktrees} but:\n` +
            errors.map(e => `   - ${e}`).join('\n') + '\n\n' +
            `   use_worktrees is the master setting.\n\n` +
            `   Fix:\n   ${fixes.join('\n   ')}`;
    }
    return null;
}
/**
 * Get all config values with schema info for display
 * Returns array of { key, value, default, description, type, values?, isDefault }
 */
export function getConfigDisplay() {
    const config = loadConfig();
    const result = [];
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
        const value = getNestedValue(config, key);
        result.push({
            key,
            value,
            default: schema.default,
            description: schema.description,
            type: schema.type,
            values: schema.values,
            isDefault: value === schema.default
        });
    }
    return result;
}
