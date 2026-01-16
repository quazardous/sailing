/**
 * Configuration Management (Technical Layer)
 *
 * Pure technical operations for config: load, parse, validate, schema.
 * Semantic accessors (getAgentConfig, getGitConfig, etc.) are in managers/config-manager.ts.
 *
 * Config file: .sailing/config.yaml
 *
 * CONFIG_SCHEMA is the single source of truth for all config variables.
 * Each variable declares: type, default, description, and valid values (for enums).
 */
import fs from 'fs';
import yaml from 'js-yaml';
import { getConfigFile } from '../managers/core-manager.js';
/**
 * Configuration Schema
 * Each component declares its config variables here.
 * Format: 'section.key': { type, default, description, values? }
 */
export const CONFIG_SCHEMA = {
    'git.main_branch': {
        type: 'string',
        default: 'main',
        description: 'Main branch name (main, master, develop, etc.)'
    },
    'git.sync_before_spawn': {
        type: 'boolean',
        default: true,
        description: 'Auto-sync parent branch from main before spawning task'
    },
    'git.merge_to_main': {
        type: 'enum',
        default: 'squash',
        values: ['squash', 'merge', 'rebase'],
        description: 'Strategy for final merge to main (PRD → main)'
    },
    'git.merge_to_prd': {
        type: 'enum',
        default: 'squash',
        values: ['squash', 'merge', 'rebase'],
        description: 'Strategy for merge to PRD branch (epic/task → prd)'
    },
    'git.merge_to_epic': {
        type: 'enum',
        default: 'merge',
        values: ['squash', 'merge', 'rebase'],
        description: 'Strategy for merge to epic branch (task → epic)'
    },
    'git.squash_level': {
        type: 'enum',
        default: 'prd',
        values: ['task', 'epic', 'prd'],
        description: 'At which level commits appear in main (task=all, prd=1 per PRD)'
    },
    'agent.use_subprocess': {
        type: 'boolean',
        default: false,
        description: 'Spawn Claude as subprocess (vs manual execution)'
    },
    'agent.use_worktrees': {
        type: 'boolean',
        default: false,
        description: 'Worktree isolation for parallel agents'
    },
    'agent.risky_mode': {
        type: 'boolean',
        default: true,
        description: 'Skip permission prompts (--dangerously-skip-permissions)'
    },
    'agent.sandbox': {
        type: 'boolean',
        default: false,
        description: 'Wrap agents with srt (sandbox-runtime, requires setup)'
    },
    'agent.timeout': {
        type: 'number',
        default: 3600,
        description: 'Agent timeout in seconds (0 = no timeout)'
    },
    'agent.merge_strategy': {
        type: 'enum',
        default: 'merge',
        values: ['merge', 'squash', 'rebase'],
        description: 'Git merge strategy for worktree changes'
    },
    'agent.model': {
        type: 'enum',
        default: 'sonnet',
        values: ['sonnet', 'opus', 'haiku'],
        description: 'Default Claude model for agents'
    },
    'agent.max_parallel': {
        type: 'number',
        default: 6,
        description: 'Maximum parallel agents (0 = unlimited)'
    },
    'agent.auto_merge': {
        type: 'boolean',
        default: false,
        description: 'Auto-merge worktree changes on task completion (local)'
    },
    'agent.auto_pr': {
        type: 'boolean',
        default: false,
        description: 'Auto-create PR/MR when agent completes successfully (WIP)'
    },
    'agent.pr_draft': {
        type: 'boolean',
        default: false,
        description: 'Create PRs as drafts by default'
    },
    'agent.pr_provider': {
        type: 'enum',
        default: 'auto',
        values: ['auto', 'github', 'gitlab'],
        description: 'PR provider (auto detects from git remote)'
    },
    'agent.mcp_mode': {
        type: 'enum',
        default: 'socket',
        values: ['socket', 'port'],
        description: 'MCP transport: socket (Unix socket) or port (TCP, required for Linux sandbox)'
    },
    'agent.mcp_port_range': {
        type: 'string',
        default: '9100-9199',
        description: 'Port range for MCP TCP mode (e.g., 9100-9199)'
    },
    'agent.max_budget_usd': {
        type: 'relative-integer',
        default: -1,
        description: 'Max budget per agent in USD (-1 = no limit)'
    },
    'agent.watchdog_timeout': {
        type: 'number',
        default: 300,
        description: 'Kill agent if no output for N seconds (0 = disabled)'
    },
    'agent.auto_diagnose': {
        type: 'boolean',
        default: true,
        description: 'Auto-run diagnostic after agent completes to detect sandbox issues'
    },
    'output.color': {
        type: 'boolean',
        default: true,
        description: 'Enable colored output'
    },
    'output.verbose': {
        type: 'number',
        default: 0,
        description: 'Verbosity level (0=normal, 1=verbose, 2=debug)'
    },
    'logging.level': {
        type: 'enum',
        default: 'info',
        values: ['debug', 'info', 'warn', 'error'],
        description: 'Minimum log level for task logs'
    },
    'ids.prd_digits': {
        type: 'number',
        default: 3,
        description: 'Number of digits for PRD IDs (PRD-001)'
    },
    'ids.epic_digits': {
        type: 'number',
        default: 3,
        description: 'Number of digits for Epic IDs (E001)'
    },
    'ids.task_digits': {
        type: 'number',
        default: 3,
        description: 'Number of digits for Task IDs (T001)'
    },
    'ids.story_digits': {
        type: 'number',
        default: 3,
        description: 'Number of digits for Story IDs (S001)'
    },
    'task.default_duration': {
        type: 'string',
        default: '1h',
        description: 'Default task duration when effort is not specified (e.g., 1h, 2h, 4h)'
    },
    'task.effort_map': {
        type: 'string',
        default: 'S=0.5h,M=1h,L=2h,XL=4h',
        description: 'Mapping of legacy T-shirt sizes to hours (for backward compatibility)'
    }
};
/**
 * Build DEFAULTS object from schema
 */
function buildDefaults() {
    const defaults = {};
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
        const parts = key.split('.');
        let obj = defaults;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!obj[parts[i]])
                obj[parts[i]] = {};
            obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = schema.default;
    }
    return defaults;
}
const DEFAULTS = buildDefaults();
// Cached config
let _config = null;
// CLI overrides (set via --with-config flag)
// Format: { 'agent.use_subprocess': false, ... }
let _configOverrides = {};
/**
 * Set config overrides from CLI flag
 * Called very early in rudder.ts before any config is loaded
 * @experimental This is an experimental feature
 */
export function setConfigOverrides(overrides) {
    _configOverrides = { ..._configOverrides, ...overrides };
    // Invalidate cache so next loadConfig() picks up overrides
    _config = null;
}
/**
 * Parse a config override string: "key=value"
 * Handles type coercion based on schema
 */
export function parseConfigOverride(override) {
    const match = override.match(/^([^=]+)=(.*)$/);
    if (!match) {
        console.error(`Invalid config override format: ${override}`);
        console.error(`Expected: key=value (e.g., agent.use_subprocess=true)`);
        return null;
    }
    const [, key, rawValue] = match;
    const schema = CONFIG_SCHEMA[key];
    if (!schema) {
        console.error(`Unknown config key: ${key}`);
        console.error(`Available keys: ${Object.keys(CONFIG_SCHEMA).join(', ')}`);
        return null;
    }
    // Coerce value based on schema type
    let value = rawValue;
    switch (schema.type) {
        case 'boolean':
            value = rawValue.toLowerCase() === 'true' || rawValue === '1';
            break;
        case 'number':
        case 'relative-integer':
            value = parseInt(rawValue, 10);
            if (isNaN(value)) {
                console.error(`Invalid number for ${key}: ${rawValue}`);
                return null;
            }
            break;
        case 'enum':
            if (schema.values && !schema.values.includes(rawValue)) {
                console.error(`Invalid value for ${key}: ${rawValue}`);
                console.error(`Valid values: ${schema.values.join(', ')}`);
                return null;
            }
            break;
        // string: use as-is
    }
    return { key, value };
}
/**
 * Get config file path
 */
export function getConfigPath() {
    return getConfigFile();
}
/**
 * Load configuration from file
 * Merges with defaults, validates values, applies CLI overrides
 */
export function loadConfig() {
    if (_config)
        return _config;
    const configPath = getConfigPath();
    let userConfig = {};
    if (fs.existsSync(configPath)) {
        try {
            const content = fs.readFileSync(configPath, 'utf8');
            userConfig = yaml.load(content) || {};
        }
        catch (e) {
            console.error(`Warning: Could not parse config.yaml: ${e.message}`);
        }
    }
    // Deep merge with defaults
    _config = deepMerge(DEFAULTS, userConfig);
    // Apply CLI overrides (--with-config flag)
    if (Object.keys(_configOverrides).length > 0) {
        for (const [key, value] of Object.entries(_configOverrides)) {
            setNestedValue(_config, key, value);
        }
    }
    // Validate
    validateConfig(_config);
    return _config;
}
/**
 * Deep merge objects
 */
function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        }
        else {
            result[key] = source[key];
        }
    }
    return result;
}
/**
 * Validate configuration values against schema
 */
function validateConfig(config) {
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
        const value = getNestedValue(config, key);
        if (value === undefined)
            continue;
        switch (schema.type) {
            case 'boolean':
                if (typeof value !== 'boolean') {
                    console.error(`Warning: ${key} should be boolean, got ${typeof value}`);
                    setNestedValue(config, key, schema.default);
                }
                break;
            case 'number':
                if (typeof value !== 'number' || value < 0) {
                    console.error(`Warning: ${key} should be positive number, got ${value}`);
                    setNestedValue(config, key, schema.default);
                }
                break;
            case 'relative-integer':
                if (typeof value !== 'number' || !Number.isInteger(value)) {
                    console.error(`Warning: ${key} should be integer, got ${value}`);
                    setNestedValue(config, key, schema.default);
                }
                break;
            case 'string':
                if (typeof value !== 'string' || value.trim() === '') {
                    console.error(`Warning: ${key} should be non-empty string, got ${typeof value}`);
                    setNestedValue(config, key, schema.default);
                }
                break;
            case 'enum':
                if (schema.values && !schema.values.includes(value)) {
                    console.error(`Warning: Invalid ${key} '${value}'. Valid: ${schema.values.join(', ')}`);
                    setNestedValue(config, key, schema.default);
                }
                break;
        }
    }
}
/**
 * Get nested value from object using dot notation
 * Exported for use by config-manager
 */
export function getNestedValue(obj, key) {
    const parts = key.split('.');
    let value = obj;
    for (const part of parts) {
        if (value === undefined || value === null)
            return undefined;
        value = value[part];
    }
    return value;
}
/**
 * Set nested value in object using dot notation
 */
function setNestedValue(obj, key, value) {
    const parts = key.split('.');
    let target = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]])
            target[parts[i]] = {};
        target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
}
// =============================================================================
// Re-exports from config-manager for backward compatibility
// Commands should prefer importing from managers/config-manager.ts
// =============================================================================
export { getAgentConfig, getGitConfig, getIdsConfig, getConfigValue, formatId, validateConfigCoherence, getConfigDisplay } from './managers/config-manager.js';
/**
 * Clear config cache (for testing or after config changes)
 */
export function clearConfigCache() {
    _config = null;
}
/**
 * Check if config file exists
 */
export function configExists() {
    return fs.existsSync(getConfigPath());
}
/**
 * Get default configuration
 */
export function getDefaults() {
    return JSON.parse(JSON.stringify(DEFAULTS));
}
/**
 * Get config schema (for documentation/tooling)
 */
export function getSchema() {
    return CONFIG_SCHEMA;
}
