/**
 * Configuration Management
 *
 * Loads and provides access to sailing configuration.
 * Config file: .sailing/config.yaml
 *
 * CONFIG_SCHEMA is the single source of truth for all config variables.
 * Each variable declares: type, default, description, and valid values (for enums).
 */
import fs from 'fs';
import yaml from 'js-yaml';
import { getConfigFile } from './core.js';

/**
 * Configuration Schema
 * Each component declares its config variables here.
 * Format: 'section.key': { type, default, description, values? }
 */
export const CONFIG_SCHEMA = {
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
    default: true,
    description: 'Enable sandbox mode (--sandbox-mode=auto-allow)'
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
    description: 'Auto-merge worktree changes on task completion'
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
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = schema.default;
  }
  return defaults;
}

const DEFAULTS = buildDefaults();

// Cached config
let _config = null;

/**
 * Get config file path
 */
export function getConfigPath() {
  return getConfigFile();
}

/**
 * Load configuration from file
 * Merges with defaults, validates values
 */
export function loadConfig() {
  if (_config) return _config;

  const configPath = getConfigPath();
  let userConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      userConfig = yaml.load(content) || {};
    } catch (e) {
      console.error(`Warning: Could not parse config.yaml: ${e.message}`);
    }
  }

  // Deep merge with defaults
  _config = deepMerge(DEFAULTS, userConfig);

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
    } else {
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
      case 'enum':
        if (!schema.values.includes(value)) {
          console.error(`Warning: Invalid ${key} '${value}'. Valid: ${schema.values.join(', ')}`);
          setNestedValue(config, key, schema.default);
        }
        break;
    }
  }
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj, key) {
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
function setNestedValue(obj, key, value) {
  const parts = key.split('.');
  let target = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!target[parts[i]]) target[parts[i]] = {};
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;
}

/**
 * Get agent configuration
 * @returns {{ use_worktrees: boolean, risky_mode: boolean, sandbox: boolean, timeout: number, merge_strategy: string }}
 */
export function getAgentConfig() {
  const config = loadConfig();
  return config.agent;
}

/**
 * Get a specific config value
 * @param {string} key - Dot-notation key (e.g., 'agent.timeout')
 * @returns {any}
 */
export function getConfigValue(key) {
  const config = loadConfig();
  const parts = key.split('.');
  let value = config;

  for (const part of parts) {
    if (value === undefined || value === null) return undefined;
    value = value[part];
  }

  return value;
}

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

/**
 * Get config schema (for documentation/tooling)
 */
export function getSchema() {
  return CONFIG_SCHEMA;
}

/**
 * Get ID configuration
 * @returns {{ prd_digits: number, epic_digits: number, task_digits: number, story_digits: number }}
 */
export function getIdsConfig() {
  const config = loadConfig();
  return config.ids;
}

/**
 * Format an ID with configured digits
 * @param {string} prefix - 'PRD-', 'E', 'T', or 'S'
 * @param {number} num - The numeric part
 * @returns {string} Formatted ID
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
