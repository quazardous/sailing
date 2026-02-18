/**
 * Archive Manager - Business logic for archiving PRDs
 *
 * Extracted from cli/commands/archive.ts following Commands > Managers > Libs architecture.
 * Commands call this manager; this manager handles config access and orchestration.
 */
import fs from 'fs';
import path from 'path';
import { getArchiveDir, getMemoryDir, loadFile, saveFile, findProjectRoot } from './core-manager.js';
import { getPrd, buildPrdIndex, clearCache } from './artefacts-manager.js';
import { findEpicPrd, findTaskEpic } from './memory-manager.js';
import { normalizeId } from '../lib/normalize.js';
import { getGit } from '../lib/git.js';
/**
 * Move file/directory using git mv if in git repo, otherwise fs.rename
 */
async function moveFile(src, dest) {
    const cwd = findProjectRoot();
    const git = getGit(cwd);
    const isRepo = await git.checkIsRepo();
    if (isRepo) {
        try {
            await git.mv(src, dest);
            return 'git';
        }
        catch {
            // Fallback to fs if git mv fails
            const destDir = path.dirname(dest);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.renameSync(src, dest);
            return 'fs';
        }
    }
    else {
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }
        fs.renameSync(src, dest);
        return 'fs';
    }
}
/**
 * Check if PRD has status "Done"
 */
export function isPrdDone(prdDir) {
    const prdFile = path.join(prdDir, 'prd.md');
    if (!fs.existsSync(prdFile))
        return false;
    const loaded = loadFile(prdFile);
    return loaded?.data?.status === 'Done';
}
/**
 * Get PRD status
 */
export function getPrdStatus(prdDir) {
    const prdFile = path.join(prdDir, 'prd.md');
    if (!fs.existsSync(prdFile))
        return 'unknown';
    const loaded = loadFile(prdFile);
    return loaded?.data?.status || 'unknown';
}
/**
 * Get all memory files associated with a PRD using reverse indexing
 */
function getPrdMemoryFiles(targetPrdId) {
    const memoryFiles = [];
    const memDir = getMemoryDir();
    if (!fs.existsSync(memDir))
        return memoryFiles;
    const normalizedPrdId = normalizeId(targetPrdId);
    const allFiles = fs.readdirSync(memDir);
    for (const file of allFiles) {
        const filePath = path.join(memDir, file);
        const ext = path.extname(file);
        if (ext !== '.md' && ext !== '.log')
            continue;
        const baseName = path.basename(file, ext);
        // PRD memory files
        if (baseName.match(/^PRD-?\d+$/i)) {
            const prdId = normalizeId(baseName);
            if (prdId === normalizedPrdId) {
                memoryFiles.push({ id: prdId, type: 'prd', file: filePath });
            }
            continue;
        }
        // Epic memory files
        if (baseName.match(/^E\d+[a-z]?$/i)) {
            const epicId = normalizeId(baseName);
            const epicPrd = findEpicPrd(epicId);
            if (epicPrd && normalizeId(epicPrd) === normalizedPrdId) {
                memoryFiles.push({ id: epicId, type: 'epic', file: filePath });
            }
            continue;
        }
        // Task log files
        if (baseName.match(/^T\d+[a-z]?$/i) && ext === '.log') {
            const taskId = normalizeId(baseName);
            const taskInfo = findTaskEpic(taskId);
            if (taskInfo) {
                const epicPrd = findEpicPrd(taskInfo.epicId);
                if (epicPrd && normalizeId(epicPrd) === normalizedPrdId) {
                    memoryFiles.push({ id: taskId, type: 'task', file: filePath });
                }
            }
            continue;
        }
    }
    return memoryFiles;
}
/**
 * Add archived_at to PRD frontmatter
 */
function addArchivedAt(prdFile) {
    const loaded = loadFile(prdFile);
    if (!loaded)
        return false;
    loaded.data.archived_at = new Date().toISOString();
    saveFile(prdFile, loaded.data, loaded.body || '');
    return true;
}
/**
 * Archive a PRD - returns result instead of calling process.exit()
 */
export async function archivePrd(prdId, options = {}) {
    const { force = false, dryRun = false } = options;
    // Find PRD
    const prd = getPrd(prdId);
    if (!prd) {
        return { success: false, error: `PRD not found: ${prdId}` };
    }
    const prdDirName = path.basename(prd.dir);
    const prdFile = path.join(prd.dir, 'prd.md');
    // Check if done
    const isDone = isPrdDone(prd.dir);
    if (!dryRun && !force && !isDone) {
        const status = getPrdStatus(prd.dir);
        return { success: false, error: `PRD ${prd.id} is not done (status: ${status})`, prdId: prd.id };
    }
    // Get memory files BEFORE moving PRD folder
    const memoryFiles = getPrdMemoryFiles(prd.id);
    // Prepare archive paths
    const archiveDir = getArchiveDir();
    const archivePrdsDir = path.join(archiveDir, 'prds');
    const archiveMemoryDir = path.join(archiveDir, 'memory', prdDirName);
    const archivePrdDest = path.join(archivePrdsDir, prdDirName);
    if (dryRun) {
        const movedFiles = [prd.dir, ...memoryFiles.map(m => m.file)];
        return { success: true, prdId: prd.id, movedFiles };
    }
    // Check if destination already exists
    if (fs.existsSync(archivePrdDest)) {
        return { success: false, error: `Archive destination already exists: ${archivePrdDest}`, prdId: prd.id };
    }
    // Create archive directories
    if (!fs.existsSync(archivePrdsDir)) {
        fs.mkdirSync(archivePrdsDir, { recursive: true });
    }
    const movedFiles = [];
    // Add archived_at to prd.md
    if (fs.existsSync(prdFile)) {
        addArchivedAt(prdFile);
    }
    // Move memory files first
    for (const m of memoryFiles) {
        const destFile = path.join(archiveMemoryDir, path.basename(m.file));
        await moveFile(m.file, destFile);
        movedFiles.push(m.file);
    }
    // Move PRD folder
    await moveFile(prd.dir, archivePrdDest);
    movedFiles.push(prd.dir);
    // Clear index cache
    clearCache();
    return { success: true, prdId: prd.id, movedFiles };
}
/**
 * Get all PRDs with status Done
 */
export function getDonePrds() {
    const prdIndex = buildPrdIndex();
    const donePrds = [];
    for (const [, prd] of prdIndex) {
        if (prd.data?.status === 'Done') {
            donePrds.push(prd);
        }
    }
    return donePrds;
}
