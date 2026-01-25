/**
 * Ensure command - Fix files with missing frontmatter
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, saveFile } from '../../managers/core-manager.js';
import { getAllEpics, getAllTasks } from '../../managers/artefacts-manager.js';
/**
 * Register ensure command
 */
export function registerEnsureCommand(program) {
    program.command('ensure')
        .description('Fix files with missing frontmatter (id, parent)')
        .action(() => {
        let fixed = 0;
        for (const prdDir of findPrdDirs()) {
            const prdFile = path.join(prdDir, 'prd.md');
            if (fs.existsSync(prdFile)) {
                const file = loadFile(prdFile);
                if (file && Object.keys(file.data).length === 0) {
                    console.log(`Would fix: ${prdFile}`);
                    fixed++;
                }
            }
        }
        for (const epicEntry of getAllEpics()) {
            const file = loadFile(epicEntry.file);
            if (file) {
                let needsFix = false;
                const fm = file.data;
                if (!fm.id) {
                    fm.id = epicEntry.id;
                    needsFix = true;
                }
                if (!fm.parent) {
                    fm.parent = epicEntry.prdId;
                    needsFix = true;
                }
                if (needsFix) {
                    saveFile(epicEntry.file, fm, file.body);
                    console.log(`Fixed: ${epicEntry.file}`);
                    fixed++;
                }
            }
        }
        for (const taskEntry of getAllTasks()) {
            const file = loadFile(taskEntry.file);
            if (file) {
                let needsFix = false;
                const fm = file.data;
                if (!fm.id) {
                    fm.id = taskEntry.id;
                    needsFix = true;
                }
                if (!fm.parent) {
                    fm.parent = taskEntry.prdId;
                    needsFix = true;
                }
                if (needsFix) {
                    saveFile(taskEntry.file, fm, file.body);
                    console.log(`Fixed: ${taskEntry.file}`);
                    fixed++;
                }
            }
        }
        console.log(`\nFixed ${fixed} file(s)`);
    });
}
