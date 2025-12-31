/**
 * Configuration Management
 *
 * Loads and provides access to sailing configuration.
 * Config file: .sailing/config.yaml
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { findProjectRoot } from './core.js';

// Default configuration values
const DEFAULTS = {
  agent: {
    use_worktrees: false,    // opt-in for worktree isolation
    risky_mode: true,        // enables --dangerously-skip-permissions
    sandbox: true,           // enables -sb --sandbox-mode=auto-allow
    timeout: 3600,           // default agent timeout in seconds
    merge_strategy: 'merge'  // merge | squash | rebase
  }
};

// Valid values for enums
const VALID_MERGE_STRATEGIES = ['merge', 'squash', 'rebase'];

// Cached config
let _config = null;

/**
 * Get config file path
 */
export function getConfigPath() {
  const projectRoot = findProjectRoot();
  return path.join(projectRoot, '.sailing', 'config.yaml');
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
 * Validate configuration values
 */
function validateConfig(config) {
  // Validate merge_strategy
  if (config.agent?.merge_strategy) {
    if (!VALID_MERGE_STRATEGIES.includes(config.agent.merge_strategy)) {
      console.error(`Warning: Invalid merge_strategy '${config.agent.merge_strategy}'. Valid: ${VALID_MERGE_STRATEGIES.join(', ')}`);
      config.agent.merge_strategy = DEFAULTS.agent.merge_strategy;
    }
  }

  // Validate timeout is positive
  if (config.agent?.timeout !== undefined) {
    if (typeof config.agent.timeout !== 'number' || config.agent.timeout < 0) {
      console.error(`Warning: Invalid timeout '${config.agent.timeout}'. Must be positive number.`);
      config.agent.timeout = DEFAULTS.agent.timeout;
    }
  }
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
