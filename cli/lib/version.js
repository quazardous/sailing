/**
 * Version management utilities
 * Handle component versions and extractors
 */
import fs from 'fs';
import path from 'path';
import { loadComponents as loadComponentsConfig, getComponentsFile, findProjectRoot } from './core.js';

// Version extractors registry
const extractors = {
  // JSON file, path is dot-notation (e.g., "version", "versions.api")
  json: (filePath, pathExpr) => {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return pathExpr.split('.').reduce((o, k) => o?.[k], data);
  },

  // Plain text file containing only the version string
  text: (filePath) => {
    return fs.readFileSync(filePath, 'utf8').trim();
  },

  // Text file with regex capture group
  regex: (filePath, pattern) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(new RegExp(pattern));
    return match?.[1];
  }
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
 * Get version for a component using its extractor
 */
export function getComponentVersion(component) {
  const projectRoot = findProjectRoot();
  const filePath = path.join(projectRoot, component.file);
  if (!fs.existsSync(filePath)) return 'N/A';

  const extractorType = component.extractor || 'json';
  const extractor = extractors[extractorType];
  if (!extractor) {
    console.error(`Unknown extractor: ${extractorType}`);
    return 'N/A';
  }

  try {
    return extractor(filePath, component.path) || 'N/A';
  } catch (e) {
    return 'N/A';
  }
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
  return getComponentVersion(mainComponent) || '0.0.0';
}

/**
 * Get all component versions
 */
export function getAllVersions() {
  const config = loadComponents();
  return config.components.map(c => ({
    name: c.name,
    version: getComponentVersion(c),
    main: c.main || false
  }));
}
