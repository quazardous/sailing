/**
 * Template Engine (prompting/templates)
 *
 * Renders Nunjucks templates for context generation.
 * Each template declares its variables in a header comment.
 *
 * Template format:
 *   {#
 *   variables:
 *     taskId: string        # Task ID
 *     mode: worktree|inline # Execution mode
 *   #}
 *   # Template content...
 */
import fs from 'fs';
import path from 'path';
import nunjucks from 'nunjucks';
import { getSailingRepoRoot, isDevInstall, getPath } from '../managers/core-manager.js';
/**
 * Get templates directory path (prompting/templates)
 * Uses same logic as getPrompting() from core.ts
 */
function getTemplatesDir() {
    // Dev install: templates at <repo>/prompting/templates/
    if (isDevInstall()) {
        return path.join(getSailingRepoRoot(), 'prompting/templates');
    }
    // Installed: check .sailing/prompting/templates first
    const localPath = getPath('prompting/templates');
    if (localPath && fs.existsSync(localPath)) {
        return localPath;
    }
    // Fallback: relative to dist (for packaged version)
    const distPath = path.join(getSailingRepoRoot(), 'prompting/templates');
    if (fs.existsSync(distPath)) {
        return distPath;
    }
    // Last resort: relative to current file
    // Source: cli/lib/template.ts → ../../prompting/templates
    // Compiled: dist/cli/lib/template.js → ../../../prompting/templates
    const srcPath = path.resolve(import.meta.dirname, '../../prompting/templates');
    if (fs.existsSync(srcPath)) {
        return srcPath;
    }
    return path.resolve(import.meta.dirname, '../../../prompting/templates');
}
// Configure Nunjucks
let env = null;
/**
 * Get Nunjucks environment (lazy init)
 */
function getEnv() {
    if (!env) {
        const templatePath = getTemplatesDir();
        env = nunjucks.configure(templatePath, {
            autoescape: false, // We're generating markdown, not HTML
            trimBlocks: true,
            lstripBlocks: true
        });
    }
    return env;
}
/**
 * Parse template header to extract variable definitions
 * Header format:
 *   {#
 *   variables:
 *     varName: type  # description
 *   #}
 */
export function parseTemplateHeader(content) {
    const variables = [];
    // Extract header comment
    const headerMatch = content.match(/^\{#\s*\n([\s\S]*?)\n#\}/);
    if (!headerMatch)
        return variables;
    const header = headerMatch[1];
    const lines = header.split('\n');
    let inVariables = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === 'variables:') {
            inVariables = true;
            continue;
        }
        if (inVariables && trimmed) {
            // Parse: varName: type  # description
            const match = trimmed.match(/^(\w+):\s*([^#]+?)(?:\s*#\s*(.*))?$/);
            if (match) {
                const [, name, type, description = ''] = match;
                const isOptional = type.includes('|null') || type.includes('optional');
                variables.push({
                    name,
                    type: type.trim(),
                    description: description.trim(),
                    optional: isOptional
                });
            }
        }
    }
    return variables;
}
/**
 * Get template info without rendering
 */
export function getTemplateInfo(templateName) {
    const templatePath = path.join(getTemplatesDir(), `${templateName}.md.njk`);
    if (!fs.existsSync(templatePath)) {
        return null;
    }
    const content = fs.readFileSync(templatePath, 'utf8');
    const variables = parseTemplateHeader(content);
    return {
        name: templateName,
        path: templatePath,
        variables
    };
}
/**
 * List all available templates
 */
export function listTemplates() {
    const templateDir = getTemplatesDir();
    if (!fs.existsSync(templateDir)) {
        return [];
    }
    const files = fs.readdirSync(templateDir);
    const templates = [];
    for (const file of files) {
        if (file.endsWith('.md.njk')) {
            const name = file.replace('.md.njk', '');
            const info = getTemplateInfo(name);
            if (info) {
                templates.push(info);
            }
        }
    }
    return templates;
}
/**
 * Render a template with variables
 */
export function renderTemplate(templateName, variables) {
    const templateFile = `${templateName}.md.njk`;
    const templatePath = path.join(getTemplatesDir(), templateFile);
    if (!fs.existsSync(templatePath)) {
        return null;
    }
    try {
        const env = getEnv();
        const rendered = env.render(templateFile, variables);
        // Remove the header comment from output
        return rendered.replace(/^\{#[\s\S]*?#\}\s*\n?/, '').trim();
    }
    catch (error) {
        console.error(`Template render error (${templateName}):`, error.message);
        return null;
    }
}
/**
 * Validate variables against template requirements
 */
export function validateVariables(templateName, variables) {
    const info = getTemplateInfo(templateName);
    if (!info) {
        return { valid: false, missing: [], extra: [] };
    }
    const required = info.variables.filter(v => !v.optional).map(v => v.name);
    const declared = info.variables.map(v => v.name);
    const provided = Object.keys(variables);
    const missing = required.filter(name => !(name in variables));
    const extra = provided.filter(name => !declared.includes(name));
    return {
        valid: missing.length === 0,
        missing,
        extra
    };
}
/**
 * Clear template cache (for hot reload during dev)
 */
export function clearTemplateCache() {
    env = null;
}
