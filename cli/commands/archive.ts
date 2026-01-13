/**
 * Archive command - Archive completed PRDs with their memory files
 *
 * Usage:
 *   rudder archive PRD-001          # Archive PRD (must be done)
 *   rudder archive PRD-001 --force  # Archive even if not done
 *   rudder archive PRD-001 --dry-run # Show what would be archived
 */
import fs from 'fs';
import path from 'path';
import { getArchiveDir, getMemoryDir, loadFile, saveFile, findProjectRoot } from '../lib/core.js';
import { getPrd, buildPrdIndex, clearIndexCache } from '../lib/index.js';
import { findEpicPrd, findTaskEpic } from '../lib/memory.js';
import { normalizeId } from '../lib/normalize.js';
import { isGitRepo, gitMv } from '../lib/git.js';
import { withModifies } from '../lib/help.js';

interface ArchiveOptions {
  force?: boolean;
  dryRun?: boolean;
  list?: boolean;
  all?: boolean;
}

/**
 * Move file/directory using git mv if in git repo, otherwise fs.rename
 */
function moveFile(src, dest) {
  const cwd = findProjectRoot();
  if (isGitRepo(cwd)) {
    const result = gitMv(src, dest, cwd);
    return result.method;
  } else {
    // Ensure parent directory exists
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
function isPrdDone(prdDir) {
  const prdFile = path.join(prdDir, 'prd.md');
  if (!fs.existsSync(prdFile)) return false;

  const loaded = loadFile(prdFile);
  return loaded?.data?.status === 'Done';
}

/**
 * Get PRD status for error message
 */
function getPrdStatus(prdDir) {
  const prdFile = path.join(prdDir, 'prd.md');
  if (!fs.existsSync(prdFile)) return 'unknown';

  const loaded = loadFile(prdFile);
  return loaded?.data?.status || 'unknown';
}

/**
 * Get all memory files associated with a PRD using reverse indexing
 * Scans memory dir and uses findEpicPrd/findTaskEpic to determine ownership
 * Returns array of {id, type, file} for PRD, epic, and task memory files (.md and .log)
 */
function getPrdMemoryFiles(targetPrdId) {
  const memoryFiles = [];
  const memDir = getMemoryDir();

  if (!fs.existsSync(memDir)) return memoryFiles;

  // Normalize target PRD ID for comparison
  const normalizedPrdId = normalizeId(targetPrdId);

  // Scan all files in memory directory
  const allFiles = fs.readdirSync(memDir);

  for (const file of allFiles) {
    const filePath = path.join(memDir, file);
    const ext = path.extname(file);

    // Only process .md and .log files
    if (ext !== '.md' && ext !== '.log') continue;

    const baseName = path.basename(file, ext);

    // PRD memory files (PRD-001.md, PRD-001.log)
    if (baseName.match(/^PRD-?\d+$/i)) {
      const prdId = normalizeId(baseName);
      if (prdId === normalizedPrdId) {
        memoryFiles.push({ id: prdId, type: 'prd', file: filePath });
      }
      continue;
    }

    // Epic memory files (E001.md, E001.log)
    if (baseName.match(/^E\d+[a-z]?$/i)) {
      const epicId = normalizeId(baseName);
      const epicPrd = findEpicPrd(epicId);
      if (epicPrd && normalizeId(epicPrd) === normalizedPrdId) {
        memoryFiles.push({ id: epicId, type: 'epic', file: filePath });
      }
      continue;
    }

    // Task log files (T001.log)
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
  if (!loaded) return false;

  loaded.data.archived_at = new Date().toISOString();
  saveFile(prdFile, loaded.data, loaded.body || '');
  return true;
}

/**
 * Archive a PRD
 */
function archivePrd(prdId, options: ArchiveOptions = {}) {
  const { force = false, dryRun = false } = options;

  // Find PRD
  const prd = getPrd(prdId);
  if (!prd) {
    console.error(`✗ PRD not found: ${prdId}`);
    process.exit(1);
  }

  const prdDirName = path.basename(prd.dir);
  const prdFile = path.join(prd.dir, 'prd.md');

  // Check if done (skip check for dry-run - always show preview)
  const isDone = isPrdDone(prd.dir);
  if (!dryRun && !force && !isDone) {
    const status = getPrdStatus(prd.dir);
    console.error(`✗ PRD ${prd.id} is not done (status: ${status})`);
    process.exit(1);
  }

  // Get memory files (must be done BEFORE moving PRD folder - uses index for reverse lookup)
  const memoryFiles = getPrdMemoryFiles(prd.id);

  // Prepare archive paths
  const archiveDir = getArchiveDir();
  const archivePrdsDir = path.join(archiveDir, 'prds');
  const archiveMemoryDir = path.join(archiveDir, 'memory', prdDirName);
  const archivePrdDest = path.join(archivePrdsDir, prdDirName);

  // Show what will be done
  console.log(dryRun ? '=== Dry Run ===' : `=== Archiving ${prd.id} ===`);
  console.log();

  console.log(`PRD folder:`);
  console.log(`  ${prd.dir}`);
  console.log(`  → ${archivePrdDest}`);
  console.log();

  if (memoryFiles.length > 0) {
    console.log(`Memory files (${memoryFiles.length}):`);
    for (const m of memoryFiles) {
      const destFile = path.join(archiveMemoryDir, path.basename(m.file));
      console.log(`  ${m.id}: ${path.basename(m.file)}`);
      console.log(`    → ${destFile}`);
    }
    console.log();
  } else {
    console.log(`Memory files: none`);
    console.log();
  }

  if (dryRun) {
    if (!isDone) {
      const status = getPrdStatus(prd.dir);
      console.log(`⚠ PRD is not done (status: ${status})`);
      console.log();
    }
    console.log(`(dry-run mode, no changes made)`);
    return;
  }

  // Create archive directories
  if (!fs.existsSync(archivePrdsDir)) {
    fs.mkdirSync(archivePrdsDir, { recursive: true });
  }

  // Check if destination already exists
  if (fs.existsSync(archivePrdDest)) {
    console.error(`✗ Archive destination already exists: ${archivePrdDest}`);
    process.exit(1);
  }

  // Add archived_at to prd.md
  if (fs.existsSync(prdFile)) {
    addArchivedAt(prdFile);
    console.log(`✓ Added archived_at to prd.md`);
  }

  // Move memory files first
  if (memoryFiles.length > 0) {
    for (const m of memoryFiles) {
      const destFile = path.join(archiveMemoryDir, path.basename(m.file));
      const method = moveFile(m.file, destFile);
      console.log(`✓ Moved ${m.id} memory${method === 'git' ? ' (git)' : ''}`);
    }
  }

  // Move PRD folder
  const method = moveFile(prd.dir, archivePrdDest);
  console.log(`✓ Moved PRD folder${method === 'git' ? ' (git)' : ''}`);

  // Clear index cache
  clearIndexCache();

  console.log();
  console.log(`✓ ${prd.id} archived successfully`);
}

/**
 * Get all PRDs with status Done
 */
function getDonePrds() {
  const prdIndex = buildPrdIndex();
  const donePrds = [];
  for (const [num, prd] of prdIndex) {
    if (prd.data?.status === 'Done') {
      donePrds.push(prd);
    }
  }
  return donePrds;
}

/**
 * List PRDs that are Done (ready to archive)
 */
function listDonePrds() {
  const donePrds = getDonePrds();

  if (donePrds.length === 0) {
    console.log('No PRDs with status Done');
    return;
  }

  console.log(`PRDs ready to archive (${donePrds.length}):\n`);
  for (const prd of donePrds) {
    const title = prd.data?.title || path.basename(prd.dir);
    console.log(`  ${prd.id}: ${title}`);
  }
  console.log();
  console.log('Use: rudder archive <prd-id> [--dry-run]');
}

/**
 * Archive all Done PRDs
 */
function archiveAllDone(dryRun = false) {
  const donePrds = getDonePrds();

  if (donePrds.length === 0) {
    console.log('No PRDs with status Done');
    return;
  }

  console.log(`${dryRun ? '=== Dry Run ===' : '=== Archiving all Done PRDs ==='}\n`);

  for (const prd of donePrds) {
    console.log(`--- ${prd.id} ---`);
    archivePrd(prd.id, { force: false, dryRun });
    console.log();
  }
}

/**
 * Register archive commands
 */
export function registerArchiveCommands(program) {
  withModifies(program
    .command('archive [prd-id]'), ['fs', 'git'])
    .description('Archive a completed PRD (or list Done PRDs if no ID)')
    .option('--list', 'List PRDs with status Done (default if no ID)')
    .option('--all', 'Archive all Done PRDs')
    .option('--force', 'Archive even if PRD is not done')
    .option('--dry-run', 'Show what would be archived without doing it')
    .action((prdId, options: ArchiveOptions) => {
      if (options.all) {
        if (options.force) {
          console.error('✗ --all and --force are incompatible');
          process.exit(1);
        }
        archiveAllDone(options.dryRun || false);
        return;
      }
      if (!prdId || options.list) {
        listDonePrds();
        return;
      }
      archivePrd(prdId, {
        force: options.force || false,
        dryRun: options.dryRun || false
      });
    });
}
