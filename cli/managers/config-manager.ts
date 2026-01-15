/**
 * Config Manager - Configuration schema, loading, validation, and semantic accessors
 *
 * Handles:
 * - Configuration schema definition (single source of truth)
 * - Config file loading and merging with defaults
 * - Config validation against schema
 * - CLI config overrides
 * - Semantic config accessors (getAgentConfig, getGitConfig, etc.)
 *
 * MANAGER: Has config access, orchestrates with core-manager for paths.
 */
import fs from 'fs';
import yaml from 'js-yaml';
import { formatIdFrom } from '../lib/normalize.js';
import type { SailingConfig, ConfigSchemaEntry, ConfigDisplayItem, ConfigSchema } from '../lib/types/config.js';

// Import path resolution from core-manager (breaks circular by using late binding)
import { getPath } from './core-manager.js';

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

/**
 * Configuration Schema - Single source of truth for all config variables.
 * Each variable declares: type, default, description, and valid values (for enums).
 */
export const CONFIG_SCHEMA: Record<string, ConfigSchemaEntry> = {
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

// ============================================================================
// CONFIG DEFAULTS (built from schema)
// ============================================================================

/**
 * Build DEFAULTS object from schema
 */
function buildConfigDefaults(): SailingConfig {
  const defaults: any = {};
  for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
    const parts = key.split('.');
    let obj = defaults;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = schema.default;
  }
  return defaults as SailingConfig;
}

const CONFIG_DEFAULTS = buildConfigDefaults();

// ============================================================================
// CONFIG STATE
// ============================================================================

let _sailingConfig: SailingConfig | null = null;
let _configOverrides: Record<string, any> = {};

// ============================================================================
// CONFIG OVERRIDES
// ============================================================================

/**
 * Set config overrides from CLI flag
 * Called very early in rudder.ts before any config is loaded
 * @experimental This is an experimental feature
 */
export function setConfigOverrides(overrides: Record<string, any>): void {
  _configOverrides = { ..._configOverrides, ...overrides };
  _sailingConfig = null;
}

/**
 * Parse a config override string: "key=value"
 * Handles type coercion based on schema
 */
export function parseConfigOverride(override: string): { key: string; value: any } | null {
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
  let value: any = rawValue;
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

// ============================================================================
// CONFIG NESTED ACCESS
// ============================================================================

/**
 * Get nested value from object using dot notation
 */
export function getNestedValue(obj: any, key: string): any {
  const parts = key.split('.');
  let value = obj;
  for (const part of parts) {
    if (value === undefined || value === null) return undefined;
    value = value[part];
  }
  return value;
}

/**
 * Set nested value in object using dot notation
 */
function setNestedValue(obj: any, key: string, value: any): void {
  const parts = key.split('.');
  let target = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!target[parts[i]]) target[parts[i]] = {};
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;
}

/**
 * Deep merge objects
 */
function deepMerge(target: any, source: any): any {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

// ============================================================================
// CONFIG LOADING & VALIDATION
// ============================================================================

/**
 * Get config file path
 */
export function getConfigPath(): string {
  return getPath('config');
}

/**
 * Load configuration from file
 * Merges with defaults, validates values, applies CLI overrides
 */
export function loadConfig(): SailingConfig {
  if (_sailingConfig) return _sailingConfig;

  const configPath = getConfigPath();
  let userConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      userConfig = yaml.load(content) || {};
    } catch (e: any) {
      console.error(`Warning: Could not parse config.yaml: ${e.message}`);
    }
  }

  // Deep merge with defaults
  _sailingConfig = deepMerge(CONFIG_DEFAULTS, userConfig) as SailingConfig;

  // Apply CLI overrides (--with-config flag)
  if (Object.keys(_configOverrides).length > 0) {
    for (const [key, value] of Object.entries(_configOverrides)) {
      setNestedValue(_sailingConfig, key, value);
    }
  }

  // Validate
  validateConfig(_sailingConfig);

  return _sailingConfig;
}

/**
 * Validate configuration values against schema
 */
function validateConfig(config: any): void {
  for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
    const value = getNestedValue(config, key);
    if (value === undefined) continue;

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
 * Clear config cache (for testing or after config changes)
 */
export function clearConfigCache(): void {
  _sailingConfig = null;
}

/**
 * Check if config file exists
 */
export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

/**
 * Get default configuration
 */
export function getConfigDefaults(): SailingConfig {
  return JSON.parse(JSON.stringify(CONFIG_DEFAULTS));
}

/**
 * Get config schema (for documentation/tooling)
 */
export function getConfigSchema(): ConfigSchema {
  return CONFIG_SCHEMA;
}

// ============================================================================
// SEMANTIC CONFIG ACCESSORS
// ============================================================================

/**
 * Get agent configuration section
 */
export function getAgentConfig(): SailingConfig['agent'] {
  const config = loadConfig();
  return config.agent;
}

/**
 * Get git configuration section
 */
export function getGitConfig(): SailingConfig['git'] {
  const config = loadConfig();
  return config.git;
}

/**
 * Get configured main branch name
 */
export function getMainBranch(): string {
  try {
    const gitConfig = getGitConfig();
    return gitConfig?.main_branch || 'main';
  } catch {
    return 'main';
  }
}

/**
 * Get IDs configuration section
 */
export function getIdsConfig(): SailingConfig['ids'] {
  const config = loadConfig();
  return config.ids;
}

/**
 * Get a specific config value by dot-notation key
 * @param key - Dot-notation key (e.g., 'agent.timeout')
 */
export function getConfigValue<T = any>(key: string): T {
  const config = loadConfig();
  return getNestedValue(config, key) as T;
}

/**
 * Get digit configuration from config
 */
export function getDigitConfig() {
  const ids = getIdsConfig();
  return {
    prd: ids.prd_digits,
    epic: ids.epic_digits,
    task: ids.task_digits,
    story: ids.story_digits
  };
}

/**
 * Format an ID with configured digits (config-aware wrapper)
 * @param prefix - 'PRD-', 'E', 'T', or 'S'
 * @param num - The numeric part
 * @returns Formatted ID (e.g., 'T001')
 */
export function formatId(prefix: string, num: number): string {
  return formatIdFrom(prefix, num, getDigitConfig());
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
export function validateConfigCoherence(): string | null {
  const config = loadConfig();
  const { use_worktrees, use_subprocess, sandbox } = config.agent;
  const errors: string[] = [];
  const fixes: string[] = [];

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
export function getConfigDisplay(): ConfigDisplayItem[] {
  const config = loadConfig();
  const result: ConfigDisplayItem[] = [];

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
