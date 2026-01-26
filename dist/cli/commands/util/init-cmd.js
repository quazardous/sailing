/**
 * Init command - Initialize sailing project
 */
import fs from 'fs';
import path from 'path';
import { getSailingDir, findProjectRoot, getArtefactsDir, getMemoryDir, getPrdsDir, getConfigSchema } from '../../managers/core-manager.js';
/**
 * Register init command
 */
export function registerInitCommand(program) {
    program.command('init')
        .description('Initialize sailing project structure')
        .option('-y, --yes', 'Overwrite existing files without prompting')
        .option('--dry-run', 'Show what would be done without making changes')
        .action((options) => {
        const projectRoot = findProjectRoot();
        const sailingDir = getSailingDir();
        const artefactsDir = getArtefactsDir();
        const distDir = path.join(path.dirname(path.dirname(import.meta.dirname)), 'disttpl');
        let created = 0;
        let skipped = 0;
        const createFile = (destPath, content, label) => {
            const exists = fs.existsSync(destPath);
            if (exists && !options.yes) {
                console.log(`⚠ Exists (skipped): ${label} — use -y to overwrite`);
                skipped++;
                return;
            }
            if (options.dryRun) {
                console.log(`Would ${exists ? 'overwrite' : 'create'}: ${label}`);
            }
            else {
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
                fs.writeFileSync(destPath, content);
                console.log(`✓ ${exists ? 'Overwritten' : 'Created'}: ${label}`);
            }
            created++;
        };
        const copyDist = (src, destPath, label) => {
            const srcPath = path.join(distDir, src);
            if (!fs.existsSync(srcPath)) {
                console.log(`⚠ Template not found: ${src}`);
                return;
            }
            createFile(destPath, fs.readFileSync(srcPath, 'utf8'), label);
        };
        console.log('Initializing sailing...\n');
        // Create directories
        const dirs = [
            { path: sailingDir, label: '.sailing/' },
            { path: artefactsDir, label: 'artefacts/' },
            { path: getMemoryDir(), label: 'memory/' },
            { path: getPrdsDir(), label: 'prds/' }
        ];
        for (const dir of dirs) {
            if (!fs.existsSync(dir.path)) {
                if (options.dryRun) {
                    console.log(`Would create dir: ${dir.label}`);
                }
                else {
                    fs.mkdirSync(dir.path, { recursive: true });
                    console.log(`✓ Created dir: ${dir.label}`);
                }
            }
        }
        // Config files
        copyDist('paths.yaml-dist', path.join(sailingDir, 'paths.yaml'), 'paths.yaml');
        copyDist('components.yaml-dist', path.join(sailingDir, 'components.yaml'), 'components.yaml');
        // Generate config.yaml from schema
        const schema = getConfigSchema();
        const configLines = ['# Sailing configuration', '# Generated from schema', ''];
        const sections = {};
        for (const [key, def] of Object.entries(schema)) {
            const [section, ...rest] = key.split('.');
            if (!sections[section])
                sections[section] = [];
            sections[section].push({ key: rest.join('.'), ...def });
        }
        for (const [section, items] of Object.entries(sections)) {
            configLines.push(`${section}:`);
            for (const item of items) {
                configLines.push(`  # ${item.description}`);
                const value = typeof item.default === 'string' ? item.default : JSON.stringify(item.default);
                configLines.push(`  ${item.key}: ${value}`);
            }
            configLines.push('');
        }
        createFile(path.join(sailingDir, 'config.yaml'), configLines.join('\n'), 'config.yaml');
        // State file
        const stateContent = JSON.stringify({ counters: { prd: 0, epic: 0, task: 0, story: 0 } }, null, 2);
        createFile(path.join(sailingDir, 'state.json'), stateContent, 'state.json');
        // Artefact templates
        copyDist('ROADMAP.md-dist', path.join(artefactsDir, 'ROADMAP.md'), 'ROADMAP.md');
        copyDist('POSTIT.md-dist', path.join(artefactsDir, 'POSTIT.md'), 'POSTIT.md');
        // Summary
        console.log('');
        if (options.dryRun) {
            console.log('Dry run complete. No changes made.');
        }
        else {
            console.log(`Init complete: ${created} created, ${skipped} skipped`);
            console.log('\nNext: Create a PRD with /dev:prd-create or rudder prd:create "Title"');
        }
    });
}
