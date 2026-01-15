/**
 * FileIO Manager - File I/O operations for markdown files and components
 *
 * MANAGER: Orchestrates file operations with config/path access.
 */
import fs from 'fs';
import yaml from 'js-yaml';
import { parseMarkdown, stringifyMarkdown } from '../lib/markdown.js';
import { getTemplates, getComponentsFile } from './core-manager.js';

export interface LoadedDoc<T = Record<string, any>> {
  data: T;
  body: string;
  filepath: string;
}

/**
 * Load a markdown file with frontmatter
 */
export function loadFile<T = Record<string, any>>(filepath: string): LoadedDoc<T> | null {
  if (!fs.existsSync(filepath)) return null;
  const content = fs.readFileSync(filepath, 'utf8');
  const { data, body } = parseMarkdown<T>(content);
  return { data, body, filepath };
}

/**
 * Save a markdown file with frontmatter
 */
export function saveFile(filepath: string, data: any, body: string): void {
  const content = stringifyMarkdown(data, body);
  fs.writeFileSync(filepath, content);
}

/**
 * Load a template file by type
 */
export function loadTemplate(type: string): string | null {
  const templatePath = `${getTemplates()}/${type}.md`;
  if (!fs.existsSync(templatePath)) return null;
  return fs.readFileSync(templatePath, 'utf8');
}

/**
 * Load components configuration
 */
export function loadComponents(): any {
  const componentsFile = getComponentsFile();
  if (!fs.existsSync(componentsFile)) return null;
  try {
    const content = fs.readFileSync(componentsFile, 'utf8');
    if (componentsFile.endsWith('.json')) {
      return JSON.parse(content);
    }
    return yaml.load(content);
  } catch (e: any) {
    console.error(`Error loading ${componentsFile}: ${e.message}`);
    return null;
  }
}

/**
 * Save components configuration
 */
export function saveComponents(data: any): void {
  const componentsFile = getComponentsFile();
  let content;
  if (componentsFile.endsWith('.json')) {
    content = JSON.stringify(data, null, 2);
  } else {
    content = yaml.dump(data, { lineWidth: -1 });
  }
  fs.writeFileSync(componentsFile, content);
}
