/**
 * Paths commands - Path management
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { jsonOut, getSailingDir, getPathsInfo, findProjectRoot, getPlaceholders, resolvePlaceholders, computeProjectHash, clearPlaceholderCache, getDevInfo } from '../../managers/core-manager.js';
import { PATHS_SCHEMA, CATEGORIES, getPathKeys, generatePathsYaml } from '../../lib/paths-schema.js';
import { addDynamicHelp } from '../../lib/help.js';
const home = os.homedir();
const toHomeRelative = (p) => p.startsWith(home) ? '~' + p.slice(home.length) : p;
// ANSI colors
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
/**
 * Register paths commands
 */
export function registerPathsCommands(program) {
    const paths = program.command('paths')
        .description('Path management (show paths, placeholders, resolve)')
        .argument('[key]', 'Path key (roadmap, artefacts, haven, agents, runs, assignments, worktrees, ...)')
        .option('--json', 'JSON output')
        .option('-p, --placeholders', 'Include placeholders in output')
        .option('-n, --no-resolve', 'Show paths with placeholders (unresolved)')
        .option('-r, --realpath', 'Show fully resolved absolute paths')
        .option('-d, --show-defaults', 'Show defaults alongside effective paths')
        .action((key, options) => {
        const pathsInfo = getPathsInfo();
        const devInfo = getDevInfo();
        const getDisplay = (v) => {
            if (options.resolve === false)
                return v.template || v.relative;
            if (options.realpath)
                return v.absolute;
            return v.relative;
        };
        if (key) {
            if (!pathsInfo[key]) {
                console.error(`Unknown path key: ${key}`);
                console.error(`Available: ${Object.keys(pathsInfo).join(', ')}`);
                process.exit(1);
            }
            console.log(getDisplay(pathsInfo[key]));
            return;
        }
        if (options.json) {
            const result = { paths: {} };
            for (const [k, v] of Object.entries(pathsInfo)) {
                result.paths[k] = getDisplay(v);
            }
            if (options.placeholders) {
                result.placeholders = getPlaceholders();
            }
            result.devInfo = devInfo;
            jsonOut(result);
            return;
        }
        console.log('Paths:\n');
        for (const [k, v] of Object.entries(pathsInfo)) {
            const display = getDisplay(v);
            const defaultPath = PATHS_SCHEMA[k]?.default;
            // Compare template (unresolved) values to detect if configured differs from schema default
            const template = v.template || '';
            const isDifferent = defaultPath ? template !== defaultPath : false;
            const displayValue = isDifferent ? yellow(display) : display;
            if (options.showDefaults && defaultPath && isDifferent) {
                // Resolve default path the same way as current path
                let defaultDisplay;
                if (options.resolve === false) {
                    // -n: show unresolved template
                    defaultDisplay = defaultPath;
                }
                else if (options.realpath) {
                    // -r: show absolute path
                    defaultDisplay = resolvePlaceholders(defaultPath);
                }
                else {
                    // default: show relative with ~ for home
                    defaultDisplay = toHomeRelative(resolvePlaceholders(defaultPath));
                }
                console.log(`  ${k.padEnd(12)} ${displayValue}`);
                console.log(`  ${''.padEnd(12)} ${dim(defaultDisplay)}`);
            }
            else {
                console.log(`  ${k.padEnd(12)} ${displayValue}`);
            }
        }
        // Dev info section
        console.log('\nDev mode:\n');
        console.log(`  isDevInstall   ${devInfo.isDevInstall}`);
        if (devInfo.repoRoot) {
            console.log(`  repoRoot       ${devInfo.repoRoot}`);
        }
        if (options.placeholders) {
            const ph = getPlaceholders();
            console.log('\nPlaceholders:\n');
            for (const [k, v] of Object.entries(ph.builtin)) {
                console.log(`  %${k}%`.padEnd(20) + v);
            }
            if (Object.keys(ph.custom).length > 0) {
                console.log('\n  Custom (paths.yaml):');
                for (const [k, v] of Object.entries(ph.custom)) {
                    console.log(`  %${k}%`.padEnd(20) + v);
                }
            }
        }
    });
    addDynamicHelp(paths, { entityType: 'paths' });
    // paths:placeholders
    paths.command('placeholders')
        .description('Show available placeholders and their values')
        .option('--json', 'JSON output')
        .action((options) => {
        const ph = getPlaceholders();
        if (options.json) {
            jsonOut(ph);
            return;
        }
        console.log('Built-in placeholders:\n');
        for (const [k, v] of Object.entries(ph.builtin)) {
            console.log(`  %${k}%`.padEnd(20) + v);
        }
        if (Object.keys(ph.custom).length > 0) {
            console.log('\nCustom placeholders (from paths.yaml):\n');
            for (const [k, v] of Object.entries(ph.custom)) {
                console.log(`  %${k}%`.padEnd(20) + v);
            }
        }
    });
    // paths:resolve
    paths.command('resolve <path>')
        .description('Resolve placeholders in a path string')
        .action((pathStr) => {
        const resolved = resolvePlaceholders(pathStr);
        console.log(resolved);
    });
    // paths:hash
    paths.command('hash')
        .description('Show project hash (used for ${project_hash})')
        .action(() => {
        const hash = computeProjectHash();
        console.log(hash);
    });
    // paths:raw
    paths.command('raw')
        .description('Show raw paths.yaml content (unresolved)')
        .option('--json', 'JSON output')
        .action((options) => {
        const projectRoot = findProjectRoot();
        const pathsFile = path.join(projectRoot, '.sailing', 'paths.yaml');
        if (!fs.existsSync(pathsFile)) {
            console.log('No paths.yaml found (using defaults)');
            return;
        }
        const content = fs.readFileSync(pathsFile, 'utf8');
        if (options.json) {
            jsonOut(yaml.load(content));
            return;
        }
        console.log(content);
    });
    // paths:check
    paths.command('check')
        .description('Validate paths exist and are writable')
        .action(() => {
        const pathsInfo = getPathsInfo();
        let allOk = true;
        console.log('Checking paths:\n');
        for (const [key, info] of Object.entries(pathsInfo)) {
            const p = info.absolute;
            let status = '✓';
            let note = '';
            if (!fs.existsSync(p)) {
                status = '✗';
                note = ' (not found)';
                allOk = false;
            }
            else {
                try {
                    fs.accessSync(p, fs.constants.W_OK);
                }
                catch {
                    status = '⚠';
                    note = ' (not writable)';
                }
            }
            console.log(`  ${status} ${key.padEnd(12)} ${p}${note}`);
        }
        console.log('');
        if (allOk) {
            console.log('All paths OK');
        }
        else {
            console.log('Some paths missing or not writable');
            process.exit(1);
        }
    });
    // paths:init
    paths.command('init')
        .description('Generate paths.yaml from schema')
        .option('--profile <name>', 'Use profile defaults (haven, sibling, project)')
        .option('--force', 'Overwrite existing paths.yaml')
        .option('--dry-run', 'Show what would be generated')
        .action((options) => {
        const sailingDir = getSailingDir();
        const pathsFile = path.join(sailingDir, 'paths.yaml');
        if (fs.existsSync(pathsFile) && !options.force && !options.dryRun) {
            console.error(`paths.yaml already exists: ${pathsFile}`);
            console.error('Use --force to overwrite or --dry-run to preview');
            process.exit(1);
        }
        const content = generatePathsYaml(options.profile);
        if (options.dryRun) {
            console.log('Would generate:\n');
            console.log(content);
            return;
        }
        if (!fs.existsSync(sailingDir)) {
            fs.mkdirSync(sailingDir, { recursive: true });
        }
        fs.writeFileSync(pathsFile, content);
        console.log(`Generated: ${pathsFile}`);
        if (options.profile) {
            console.log(`Profile: ${options.profile}`);
        }
    });
    // paths:set
    paths.command('set <key> <value>')
        .description('Set a path value in paths.yaml')
        .action((key, value) => {
        if (!PATHS_SCHEMA[key]) {
            console.error(`Unknown path key: ${key}`);
            console.error(`Available: ${getPathKeys().join(', ')}`);
            process.exit(1);
        }
        const sailingDir = getSailingDir();
        const pathsFile = path.join(sailingDir, 'paths.yaml');
        let config = { paths: {} };
        if (fs.existsSync(pathsFile)) {
            try {
                const content = fs.readFileSync(pathsFile, 'utf8');
                config = yaml.load(content) || { paths: {} };
                if (!config.paths)
                    config.paths = {};
            }
            catch (e) {
                console.error(`Error reading paths.yaml: ${e.message}`);
                process.exit(1);
            }
        }
        else {
            if (!fs.existsSync(sailingDir)) {
                fs.mkdirSync(sailingDir, { recursive: true });
            }
        }
        config.paths[key] = value;
        const lines = ['# Sailing path configuration', '', 'paths:'];
        for (const [k, v] of Object.entries(config.paths)) {
            lines.push(`  ${k}: ${v}`);
        }
        fs.writeFileSync(pathsFile, lines.join('\n') + '\n');
        clearPlaceholderCache();
        console.log(`Set: ${key} = ${value}`);
    });
    // paths:get
    paths.command('get <key>')
        .description('Get a path value')
        .option('-r, --raw', 'Show raw value (unresolved)')
        .action((key, options) => {
        const pathsInfo = getPathsInfo();
        if (!pathsInfo[key]) {
            if (PATHS_SCHEMA[key]) {
                console.log(options.raw ? PATHS_SCHEMA[key].default : resolvePlaceholders(PATHS_SCHEMA[key].default));
            }
            else {
                console.error(`Unknown path key: ${key}`);
                process.exit(1);
            }
            return;
        }
        const info = pathsInfo[key];
        console.log(options.raw ? (info.template || info.relative) : info.absolute);
    });
    // paths:schema
    paths.command('schema')
        .description('Show paths schema with defaults and profiles')
        .option('--json', 'JSON output')
        .action((options) => {
        if (options.json) {
            jsonOut({ schema: PATHS_SCHEMA, categories: CATEGORIES });
            return;
        }
        const byCategory = {};
        for (const [key, schema] of Object.entries(PATHS_SCHEMA)) {
            const cat = schema.category;
            if (!byCategory[cat])
                byCategory[cat] = [];
            byCategory[cat].push({ key, ...schema });
        }
        for (const [category, items] of Object.entries(byCategory)) {
            const catName = CATEGORIES[category] || category;
            console.log(`\n${catName}:`);
            console.log('-'.repeat(catName.length + 1));
            for (const item of items) {
                console.log(`  ${item.key}`);
                console.log(`    default: ${item.default}`);
                if (item.profiles) {
                    for (const [profile, value] of Object.entries(item.profiles)) {
                        console.log(`    ${profile}: ${value}`);
                    }
                }
            }
        }
    });
    return paths;
}
