/**
 * FileIO Manager - File I/O operations for markdown files and components
 *
 * MANAGER: Orchestrates file operations with config/path access.
 */
import fs from 'fs';
import yaml from 'js-yaml';
import { parseMarkdown, stringifyMarkdown } from '../lib/markdown.js';
import { getTemplates, getComponentsFile } from './core-manager.js';
/**
 * Load a markdown file with frontmatter
 */
export function loadFile(filepath) {
    if (!fs.existsSync(filepath))
        return null;
    const content = fs.readFileSync(filepath, 'utf8');
    const { data, body } = parseMarkdown(content);
    return { data, body, filepath };
}
/**
 * Save a markdown file with frontmatter
 */
export function saveFile(filepath, data, body) {
    const content = stringifyMarkdown(data, body);
    fs.writeFileSync(filepath, content);
}
/**
 * Load a template file by type
 */
export function loadTemplate(type) {
    const templatePath = `${getTemplates()}/${type}.md`;
    if (!fs.existsSync(templatePath))
        return null;
    return fs.readFileSync(templatePath, 'utf8');
}
/**
 * Load components configuration
 */
export function loadComponents() {
    const componentsFile = getComponentsFile();
    if (!fs.existsSync(componentsFile))
        return null;
    try {
        const content = fs.readFileSync(componentsFile, 'utf8');
        if (componentsFile.endsWith('.json')) {
            return JSON.parse(content);
        }
        return yaml.load(content);
    }
    catch (e) {
        console.error(`Error loading ${componentsFile}: ${e.message}`);
        return null;
    }
}
/**
 * Save components configuration
 */
export function saveComponents(data) {
    const componentsFile = getComponentsFile();
    let content;
    if (componentsFile.endsWith('.json')) {
        content = JSON.stringify(data, null, 2);
    }
    else {
        content = yaml.dump(data, { lineWidth: -1 });
    }
    fs.writeFileSync(componentsFile, content);
}
