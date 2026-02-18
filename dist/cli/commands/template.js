/**
 * Template commands for rudder CLI
 * Renders Nunjucks templates with config-aware variable defaults
 */
import fs from 'fs';
import path from 'path';
import { renderFile, parseTemplateHeader } from '../managers/template-manager.js';
import { getAgentConfig } from '../managers/config-manager.js';
/**
 * Accumulator for --var key=value options
 */
function collectVar(val, acc) {
    const eq = val.indexOf('=');
    if (eq === -1) {
        console.error(`Invalid --var format: ${val} (expected key=value)`);
        process.exit(1);
    }
    acc[val.slice(0, eq)] = val.slice(eq + 1);
    return acc;
}
/**
 * Build default variables from project config
 */
function getConfigDefaults() {
    try {
        const agentConfig = getAgentConfig();
        return {
            mode: agentConfig.use_worktrees ? 'worktree' : 'inline',
        };
    }
    catch {
        // No config available (e.g. no .sailing/config.yaml) — empty defaults
        return {};
    }
}
/**
 * Register template commands
 */
export function registerTemplateCommands(program) {
    const tpl = program.command('template');
    tpl.description('Template rendering utilities');
    // template:render
    tpl.command('render')
        .description('Render a Nunjucks template file')
        .argument('<template-path>', 'Path to .njk template file')
        .option('--var <key=value>', 'Set template variable (repeatable)', collectVar, {})
        .option('-o, --output <file>', 'Write output to file (default: stdout)')
        .action((templatePath, options) => {
        const absPath = path.resolve(templatePath);
        if (!fs.existsSync(absPath)) {
            console.error(`Template not found: ${absPath}`);
            process.exit(1);
        }
        // Config defaults, overridden by --var
        const defaults = getConfigDefaults();
        const variables = { ...defaults, ...options.var };
        const result = renderFile(absPath, variables);
        if (result === null) {
            console.error(`Failed to render template: ${templatePath}`);
            process.exit(1);
        }
        if (options.output) {
            const outPath = path.resolve(options.output);
            fs.writeFileSync(outPath, result + '\n');
            console.error(`Written: ${options.output}`);
        }
        else {
            process.stdout.write(result + '\n');
        }
    });
    // template:info
    tpl.command('info')
        .description('Show template variable declarations')
        .argument('<template-path>', 'Path to .njk template file')
        .action((templatePath) => {
        const absPath = path.resolve(templatePath);
        if (!fs.existsSync(absPath)) {
            console.error(`Template not found: ${absPath}`);
            process.exit(1);
        }
        const content = fs.readFileSync(absPath, 'utf8');
        const variables = parseTemplateHeader(content);
        if (variables.length === 0) {
            console.log('No variables declared in template header');
            return;
        }
        console.log('Variables:');
        for (const v of variables) {
            const opt = v.optional ? ' (optional)' : '';
            const desc = v.description ? ` — ${v.description}` : '';
            console.log(`  ${v.name}: ${v.type}${opt}${desc}`);
        }
        // Show config defaults
        const defaults = getConfigDefaults();
        const relevant = variables.filter(v => v.name in defaults);
        if (relevant.length > 0) {
            console.log('\nConfig defaults:');
            for (const v of relevant) {
                console.log(`  ${v.name} = ${defaults[v.name]}`);
            }
        }
    });
}
