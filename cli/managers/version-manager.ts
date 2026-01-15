/**
 * Version management utilities
 * Handle component versions and extractors
 */
import fs from 'fs';
import path from 'path';
import { execaSync } from 'execa';
import { loadComponents as loadComponentsConfig, getComponentsFile, findProjectRoot } from './core-manager.js';

type SemverParts = { major: number; minor: number; patch: number };

type ExtractorResult = { version: string | null; source: string };

type BumperResult = {
  success: boolean;
  oldVersion?: string;
  newVersion?: string;
  source?: string;
  error?: string;
  component?: string;
};

type ComponentConfig = {
  key: string;
  name?: string;
  file?: string;
  path?: string;
  extractor?: 'json' | 'text' | 'regex' | 'git';
  main?: boolean;
  changelog?: string | null;
};

/**
 * Parse semver version string
 * @param {string} version - Version string (e.g., "1.2.3")
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
function parseSemver(version: string): SemverParts | null {
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
function incrementSemver(version: string, type: 'major' | 'minor' | 'patch'): string | null {
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
const extractors: Record<string, (filePath: string | null, pathExpr?: string) => ExtractorResult> = {
  // JSON file, path is dot-notation (e.g., "version", "versions.api")
  json: (filePath, pathExpr = 'version') => {
    if (!filePath) return { version: null, source: 'missing file' };
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const version = pathExpr.split('.').reduce((o, k) => o?.[k], data);
    return { version: version ?? null, source: `${path.basename(filePath)}:${pathExpr}` };
  },

  // Plain text file containing only the version string
  text: (filePath) => {
    if (!filePath) return { version: null, source: 'missing file' };
    const version = fs.readFileSync(filePath, 'utf8').trim();
    return { version, source: path.basename(filePath) };
  },

  // Text file with regex capture group
  regex: (filePath, pattern) => {
    if (!filePath || !pattern) return { version: null, source: 'missing file or pattern' };
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(new RegExp(pattern));
    return { version: match?.[1] ?? null, source: `${path.basename(filePath)}:/${pattern}/` };
  },

  // Git tag - gets latest tag matching pattern (default: v*)
  git: (_filePath, pattern = 'v*') => {
    const projectRoot = findProjectRoot();
    let tag = '';

    // Try git describe first
    try {
      const result = execaSync('git', ['describe', '--tags', '--abbrev=0', '--match', pattern], {
        cwd: projectRoot,
        reject: false
      });
      if (result.exitCode === 0) {
        tag = String(result.stdout).trim();
      }
    } catch { /* ignore */ }

    // Fallback to git tag -l with sorting
    if (!tag) {
      try {
        const result = execaSync('git', ['tag', '-l', pattern, '--sort=-v:refname'], {
          cwd: projectRoot,
          reject: false
        });
        if (result.exitCode === 0) {
          const tags = String(result.stdout).trim().split('\n');
          tag = tags[0] || '';
        }
      } catch { /* ignore */ }
    }

    const version = tag.replace(/^v/, '') || null;
    return { version, source: `git tag ${pattern}` };
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
const bumpers: Record<string, (filePath: string, pathExpr: string, newVersion: string) => BumperResult> = {
  // JSON file - update version at dot-notation path
  json: (filePath, pathExpr, newVersion) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    const keys = pathExpr.split('.');
    const lastKey = keys.pop();
    const parent = keys.reduce<Record<string, unknown> | unknown>((o, k) => {
      if (o && typeof o === 'object') {
        return (o as Record<string, unknown>)[k];
      }
      return undefined;
    }, data as Record<string, unknown>);

    if (!parent || typeof parent !== 'object' || lastKey === undefined) {
      return { success: false, error: `Invalid path: ${pathExpr}` };
    }

    const parentObj = parent as Record<string, unknown>;
    const oldVersion = typeof parentObj[lastKey] === 'string' ? (parentObj[lastKey]) : undefined;
    parentObj[lastKey] = newVersion;

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
export function loadComponents(): { components: ComponentConfig[] } {
  const config = loadComponentsConfig();
  if (!config) {
    console.error(`Components config not found: ${getComponentsFile()}`);
    process.exit(1);
  }
  return config as { components: ComponentConfig[] };
}

/**
 * Get version info for a component using its extractor
 * @returns {{ version: string|null, source: string }}
 */
export function getComponentVersionInfo(component: ComponentConfig): ExtractorResult {
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
    } catch {
      return { version: null, source: `git tag ${component.path || 'v*'}` };
    }
  }

  // File-based extractors
  const projectRoot = findProjectRoot();
  const filePath = path.join(projectRoot, component.file || '');
  if (!fs.existsSync(filePath)) {
    return { version: null, source: `${component.file} (not found)` };
  }

  try {
    return extractor(filePath, component.path);
  } catch {
    return { version: null, source: `${component.file} (error)` };
  }
}

/**
 * Get version string for a component (legacy, returns string only)
 */
export function getComponentVersion(component: ComponentConfig): string | null {
  return getComponentVersionInfo(component).version;
}

/**
 * Get CLI/package version (independent of project components)
 * Checks common locations for dev/dist usage.
 */
export function getCliVersion(): string {
  const candidates = [
    path.resolve(import.meta.dirname, '../package.json'),       // dist/cli/package.json (if published)
    path.resolve(import.meta.dirname, '../../package.json'),    // dist/package.json
    path.resolve(import.meta.dirname, '../../../package.json'), // repo root package.json
    path.resolve(import.meta.dirname, '../../cli/package.json') // repo cli/package.json (tsx/dev)
  ];
  for (const pkgPath of candidates) {
    try {
      if (!fs.existsSync(pkgPath)) continue;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg?.version) return pkg.version as string;
    } catch { /* ignore and try next */ }
  }
  return '0.0.0';
}

/**
 * Get main version (from component marked as main)
 * Returns '0.0.0' if components config is missing (for init/paths commands)
 */
export function getMainVersion(): string {
  const config = loadComponentsConfig();
  if (config) {
    const mainComponent = config.components?.find((c: ComponentConfig) => c.main);
    if (mainComponent) {
      const version = getComponentVersion(mainComponent);
      if (version && version !== 'N/A') return version;
    }
  }

  // Fallback: use package.json version (dev mode) to avoid 0.0.0 when components.yaml is missing
  try {
    // Try candidate package.json locations (dist/cli/lib -> dist/cli -> dist -> repo root)
    const candidates = [
      path.resolve(import.meta.dirname, '../package.json'),       // dist/cli/package.json (typically absent)
      path.resolve(import.meta.dirname, '../../package.json'),    // dist/package.json (typically absent)
      path.resolve(import.meta.dirname, '../../../package.json'), // repo root package.json
      path.resolve(import.meta.dirname, '../../cli/package.json') // repo cli/package.json (when run from tsx)
    ];
    for (const pkgPath of candidates) {
      if (!fs.existsSync(pkgPath)) continue;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg?.version) return pkg.version as string;
    }
  } catch { /* ignore */ }

  return '0.0.0';
}

/**
 * Get main component name
 * Returns 'Project' if components config is missing
 */
export function getMainComponentName(): string {
  const config = loadComponentsConfig();
  if (!config) return 'Project';
  const mainComponent = config.components?.find((c: ComponentConfig) => c.main);
  if (!mainComponent) return 'Project';
  return mainComponent.name || mainComponent.key || 'Project';
}

/**
 * Get all component versions
 */
export function getAllVersions() {
  const config = loadComponents();
  return config.components.map((c: ComponentConfig) => {
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
export function findComponent(key: string): ComponentConfig | null {
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
export function bumpComponentVersion(
  componentKey: string,
  bumpType: 'major' | 'minor' | 'patch',
  { dryRun = false }: { dryRun?: boolean } = {}
): BumperResult & { dryRun?: boolean; component?: string } {
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
  const filePath = path.join(projectRoot, component.file || '');

  if (!fs.existsSync(filePath)) {
    return { success: false, error: `File not found: ${component.file}` };
  }

  // Execute the bump
  try {
    const result = bumper(filePath, component.path || '', newVersion);
    if (result.success) {
      result.component = component.name || component.key;
    }
    return result;
  } catch (e) {
    const err = e as Error;
    return { success: false, error: `Bump failed: ${err.message}` };
  }
}
