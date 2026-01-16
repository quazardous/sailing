/**
 * Fix commands - Fix common issues
 */
import fs from 'fs';
import path from 'path';
import { findProjectRoot } from '../../managers/core-manager.js';
/**
 * Register fix commands
 */
export function registerFixCommands(program) {
    const fix = program.command('fix')
        .description('Fix common issues');
    fix.command('chmod')
        .description('Fix file permissions (600 → 644) caused by Claude Code Write tool')
        .option('--dry-run', 'Show what would be done')
        .action((options) => {
        const projectRoot = findProjectRoot();
        const extensions = ['js', 'md', 'yaml', 'yml', 'json', 'sh', 'txt'];
        let fixed = 0;
        const fixPerms = (filePath) => {
            try {
                const stats = fs.statSync(filePath);
                const mode = stats.mode & 0o777;
                if (mode === 0o600) {
                    if (options.dryRun) {
                        console.log(`Would fix: ${path.relative(projectRoot, filePath)}`);
                    }
                    else {
                        fs.chmodSync(filePath, 0o644);
                        console.log(`Fixed: ${path.relative(projectRoot, filePath)}`);
                    }
                    fixed++;
                }
            }
            catch {
                // Ignore errors
            }
        };
        const walkDir = (dir) => {
            if (!fs.existsSync(dir))
                return;
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        if (entry.name !== 'node_modules' && entry.name !== '.git') {
                            walkDir(fullPath);
                        }
                    }
                    else if (entry.isFile()) {
                        const ext = path.extname(entry.name).slice(1);
                        if (extensions.includes(ext) || entry.name.startsWith('.')) {
                            fixPerms(fullPath);
                        }
                    }
                }
            }
            catch {
                // Ignore permission errors
            }
        };
        console.log('Scanning for files with 600 permissions...\n');
        walkDir(projectRoot);
        if (fixed === 0) {
            console.log('No files need fixing.');
        }
        else {
            console.log(`\n${options.dryRun ? 'Would fix' : 'Fixed'}: ${fixed} file(s)`);
        }
    });
    return fix;
}
