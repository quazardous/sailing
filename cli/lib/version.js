/**
 * Version management utilities
 * Handle component versions and extractors
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { loadComponents as loadComponentsConfig, getComponentsFile, findProjectRoot } from './core.js';

/**
 * Parse semver version string
 * @param {string} version - Version string (e.g., "1.2.3")
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
function parseSemver(version) {
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  };
}

/**
 * Increment semver version
 * @param {string} version - Current version
 * @param {'major'|'minor'|'patch'} type - Bump type
 * @returns {string|null} - New version or null if invalid
 */
function incrementSemver(version, type) {
  const parsed = parseSemver(version);
  if (!parsed) return null;

  switch (type) {
    case 'major':
      return `${parsed.major + 1}.0.0`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    default:
      return null;
  }
}

/**
 * Version extractors registry
 * Each extractor returns { version, source } where:
 *   - version: the extracted version string (or null)
 *   - source: human-readable resource string describing the source
 */
const extractors = {
  // JSON file, path is dot-notation (e.g., "version", "versions.api")
  json: (filePath, pathExpr) => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const version = pathExpr.split('.').reduce((o, k) => o?.[k], data);
    return { version, source: `${path.basename(filePath)}:${pathExpr}` };
  },

  // Plain text file containing only the version string
  text: (filePath) => {
    const version = fs.readFileSync(filePath, 'utf8').trim();
    return { version, source: path.basename(filePath) };
  },

  // Text file with regex capture group
  regex: (filePath, pattern) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(new RegExp(pattern));
    return { version: match?.[1], source: `${path.basename(filePath)}:/${pattern}/` };
  },

  // Git tag - gets latest tag matching pattern (default: v*)
  git: (_filePath, pattern = 'v*') => {
    try {
      const projectRoot = findProjectRoot();
      const tag = execSync(
        `git describe --tags --abbrev=0 --match "${pattern}" 2>/dev/null || git tag -l "${pattern}" --sort=-v:refname 2>/dev/null | head -1`,
        { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      const version = tag.replace(/^v/, '') || null;
      return { version, source: `git tag ${pattern}` };
    } catch {
      return { version: null, source: `git tag ${pattern}` };
    }
  }
};

/**
 * Version bumpers registry
 * Each bumper writes the new version to the source file
 * Returns { success, oldVersion, newVersion, source, error? }
 *
 * Bumpers are optional - if not defined for an extractor type,
 * bumpComponentVersion will return an explicit error
 */
const bumpers = {
  // JSON file - update version at dot-notation path
  json: (filePath, pathExpr, newVersion) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    const keys = pathExpr.split('.');
    const lastKey = keys.pop();
    const parent = keys.reduce((o, k) => o?.[k], data);

    if (!parent || typeof parent !== 'object') {
      return { success: false, error: `Invalid path: ${pathExpr}` };
    }

    const oldVersion = parent[lastKey];
    parent[lastKey] = newVersion;

    // Preserve original formatting (detect indent)
    const indent = content.match(/^[ \t]+/m)?.[0]?.length || 2;
    fs.writeFileSync(filePath, JSON.stringify(data, null, indent) + '\n', 'utf8');

    return {
      success: true,
      oldVersion,
      newVersion,
      source: `${path.basename(filePath)}:${pathExpr}`
    };
  },

  // Plain text file - replace entire content
  text: (filePath, _pathExpr, newVersion) => {
    const oldVersion = fs.readFileSync(filePath, 'utf8').trim();
    fs.writeFileSync(filePath, newVersion + '\n', 'utf8');

    return {
      success: true,
      oldVersion,
      newVersion,
      source: path.basename(filePath)
    };
  },

  // Regex file - replace matched version in content
  regex: (filePath, pattern, newVersion) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const regex = new RegExp(pattern);
    const match = content.match(regex);

    if (!match || !match[1]) {
      return { success: false, error: `Pattern not found: ${pattern}` };
    }

    const oldVersion = match[1];
    // Replace only the captured group (version) within the match
    const newContent = content.replace(regex, (fullMatch) => {
      return fullMatch.replace(oldVersion, newVersion);
    });

    fs.writeFileSync(filePath, newContent, 'utf8');

    return {
      success: true,
      oldVersion,
      newVersion,
      source: `${path.basename(filePath)}:/${pattern}/`
    };
  }

  // Note: 'git' extractor has no bumper - use git tag commands directly
};

/**
 * Load components configuration
 */
export function loadComponents() {
  const config = loadComponentsConfig();
  if (!config) {
    console.error(`Components config not found: ${getComponentsFile()}`);
    process.exit(1);
  }
  return config;
}

/**
 * Get version info for a component using its extractor
 * @returns {{ version: string|null, source: string }}
 */
export function getComponentVersionInfo(component) {
  const extractorType = component.extractor || 'json';
  const extractor = extractors[extractorType];
  if (!extractor) {
    console.error(`Unknown extractor: ${extractorType}`);
    return { version: null, source: 'unknown' };
  }

  // Git extractor doesn't need a file
  if (extractorType === 'git') {
    try {
      return extractor(null, component.path);
    } catch (e) {
      return { version: null, source: `git tag ${component.path || 'v*'}` };
    }
  }

  // File-based extractors
  const projectRoot = findProjectRoot();
  const filePath = path.join(projectRoot, component.file);
  if (!fs.existsSync(filePath)) {
    return { version: null, source: `${component.file} (not found)` };
  }

  try {
    return extractor(filePath, component.path);
  } catch (e) {
    return { version: null, source: `${component.file} (error)` };
  }
}

/**
 * Get version string for a component (legacy, returns string only)
 */
export function getComponentVersion(component) {
  return getComponentVersionInfo(component).version;
}

/**
 * Get main version (from component marked as main)
 * Returns '0.0.0' if components config is missing (for init/paths commands)
 */
export function getMainVersion() {
  const config = loadComponentsConfig();
  if (!config) return '0.0.0';
  const mainComponent = config.components?.find(c => c.main);
  if (!mainComponent) return '0.0.0';
  const version = getComponentVersion(mainComponent);
  return (version && version !== 'N/A') ? version : '0.0.0';
}

/**
 * Get main component name
 * Returns 'Project' if components config is missing
 */
export function getMainComponentName() {
  const config = loadComponentsConfig();
  if (!config) return 'Project';
  const mainComponent = config.components?.find(c => c.main);
  if (!mainComponent) return 'Project';
  return mainComponent.name || mainComponent.key || 'Project';
}

/**
 * Get all component versions
 */
export function getAllVersions() {
  const config = loadComponents();
  return config.components.map(c => {
    const info = getComponentVersionInfo(c);
    return {
      name: c.name,
      version: info.version || '0.0.0',
      source: info.source,
      main: c.main || false,
      changelog: c.changelog || null
    };
  });
}

/**
 * Find component by key
 * @param {string} key - Component key
 * @returns {object|null}
 */
export function findComponent(key) {
  const config = loadComponents();
  return config.components?.find(c => c.key === key) || null;
}

/**
 * Bump component version
 * @param {string} componentKey - Component key from components.yaml
 * @param {'major'|'minor'|'patch'} bumpType - Type of version bump
 * @param {object} options - Options
 * @param {boolean} options.dryRun - If true, only check if bump is possible without writing
 * @returns {{ success: boolean, oldVersion?: string, newVersion?: string, source?: string, error?: string }}
 */
export function bumpComponentVersion(componentKey, bumpType, { dryRun = false } = {}) {
  // Validate bump type
  if (!['major', 'minor', 'patch'].includes(bumpType)) {
    return { success: false, error: `Invalid bump type: ${bumpType}. Use major, minor, or patch` };
  }

  // Find component
  const component = findComponent(componentKey);
  if (!component) {
    return { success: false, error: `Component not found: ${componentKey}` };
  }

  const extractorType = component.extractor || 'json';

  // Check if bumper exists for this extractor type
  const bumper = bumpers[extractorType];
  if (!bumper) {
    return {
      success: false,
      error: `No bumper available for extractor '${extractorType}'. ` +
             `Extractor '${extractorType}' does not support automatic version bumping. ` +
             (extractorType === 'git' ? 'Use git tag commands directly to create a new version tag.' : '')
    };
  }

  // Get current version
  const versionInfo = getComponentVersionInfo(component);
  if (!versionInfo.version) {
    return { success: false, error: `Could not read current version from ${versionInfo.source}` };
  }

  // Calculate new version
  const newVersion = incrementSemver(versionInfo.version, bumpType);
  if (!newVersion) {
    return {
      success: false,
      error: `Invalid semver format: ${versionInfo.version}. Expected format: X.Y.Z`
    };
  }

  // Dry run - just return what would happen
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      oldVersion: versionInfo.version,
      newVersion,
      source: versionInfo.source,
      component: component.name || component.key
    };
  }

  // Get file path for file-based bumpers
  const projectRoot = findProjectRoot();
  const filePath = path.join(projectRoot, component.file);

  if (!fs.existsSync(filePath)) {
    return { success: false, error: `File not found: ${component.file}` };
  }

  // Execute the bump
  try {
    const result = bumper(filePath, component.path, newVersion);
    if (result.success) {
      result.component = component.name || component.key;
    }
    return result;
  } catch (e) {
    return { success: false, error: `Bump failed: ${e.message}` };
  }
}
