/**
 * Renumber commands for rudder CLI
 *
 * Handles duplicate ID detection and renumbering of epics/tasks.
 *
 * Usage:
 *   rudder renumber --check              # Detect duplicates
 *   rudder renumber --fix                # Auto-fix duplicates (keep oldest, scope prd)
 *   rudder renumber --fix --keep PRD-001/E001   # Explicit keep
 *   rudder renumber --fix --scope project       # Update all refs
 *   rudder renumber PRD-002/E001 E042           # Manual rename
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, saveFile, getMemoryDir, jsonOut } from '../managers/core-manager.js';
import { normalizeId, extractNumericKey, getEntityType } from '../lib/normalize.js';
import { formatId } from '../managers/core-manager.js';
import { buildMemoryIndex, getAllEpics, getAllTasks } from '../managers/artefacts-manager.js';
import { nextId, peekNextId } from '../managers/state-manager.js';

/**
 * Get creation date from frontmatter or file mtime
 */
function getCreationDate(filePath) {
  const data = loadFile(filePath);
  if (data?.data?.created_at) {
    return new Date(data.data.created_at);
  }
  return fs.statSync(filePath).mtime;
}

/**
 * Build index of all epics grouped by numeric key
 * Returns Map<numericKey, Array<{id, file, prdDir, prdId, created}>>
 * Uses artefacts.ts contract for epic access
 */
function buildEpicIndexForDuplicates() {
  const index = new Map();

  for (const epicEntry of getAllEpics()) {
    const data = epicEntry.data;
    if (!data?.id) continue;

    const id = data.id;
    const key = extractNumericKey(id);
    if (!key) continue;

    const prdDirName = path.basename(epicEntry.prdDir);
    const prdId = prdDirName.match(/^PRD-\d+/)?.[0] || prdDirName;

    const entry = {
      id,
      file: epicEntry.file,
      prdDir: epicEntry.prdDir,
      prdId,
      created: getCreationDate(epicEntry.file)
    };

    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key).push(entry);
  }

  return index;
}

/**
 * Build index of all tasks grouped by numeric key
 * Returns Map<numericKey, Array<{id, file, prdDir, prdId, epicId, created}>>
 * Uses artefacts.ts contract for task access
 */
function buildTaskIndexForDuplicates() {
  const index = new Map();

  for (const taskEntry of getAllTasks()) {
    const data = taskEntry.data;
    if (!data?.id) continue;

    const id = data.id;
    const key = extractNumericKey(id);
    if (!key) continue;

    // Extract prdDir from task file path
    const tasksDir = path.dirname(taskEntry.file);
    const prdDir = path.dirname(tasksDir);
    const prdDirName = path.basename(prdDir);
    const prdId = prdDirName.match(/^PRD-\d+/)?.[0] || prdDirName;

    // Extract epic from parent field
    const parent = data.parent || '';
    const epicMatch = parent.match(/E\d+/i);
    const epicId = epicMatch ? epicMatch[0].toUpperCase() : null;

    const entry = {
      id,
      file: taskEntry.file,
      prdDir,
      prdId,
      epicId,
      created: getCreationDate(taskEntry.file)
    };

    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key).push(entry);
  }

  return index;
}

/**
 * Find duplicates in an index
 * Returns array of { key, items } where items.length > 1
 */
function findDuplicates(index) {
  const duplicates = [];
  for (const [key, items] of index) {
    if (items.length > 1) {
      // Sort by creation date (oldest first)
      items.sort((a, b) => a.created - b.created);
      duplicates.push({ key, items });
    }
  }
  return duplicates;
}

/**
 * Get next available ID for a type (E or T)
 * Uses centralized state.json counter (same as create commands)
 */
function getNextAvailableId(type) {
  // Map type prefix to state counter name
  const counterName = type === 'E' ? 'epic' : 'task';
  const num = nextId(counterName);
  return formatId(type, num);
}

/**
 * Preview next available ID without incrementing counter (for --check)
 * @param {string} type - 'E' or 'T'
 * @param {number} offset - How many IDs ahead (for multiple renames)
 */
function previewNextId(type, offset = 0) {
  const counterName = type === 'E' ? 'epic' : 'task';
  const num = peekNextId(counterName) + offset;
  return formatId(type, num);
}

/**
 * Rename an epic file and update all references
 * @param {string} epicFile - Path to epic file
 * @param {string} newId - New epic ID (e.g., E042)
 * @param {string} scope - 'prd' | 'epic' | 'project'
 * @param {string} prdDir - PRD directory containing the epic
 */
function renameEpic(epicFile, newId, scope, prdDir) {
  const data = loadFile(epicFile);
  const oldId = data.data.id;
  const oldKey = extractNumericKey(oldId);
  const newKey = extractNumericKey(newId);

  const results = {
    renamed: null,
    refsUpdated: [],
    memoryRenamed: null,
    errors: []
  };

  // 1. Rename epic file
  const epicDir = path.dirname(epicFile);
  const oldBasename = path.basename(epicFile);
  const newBasename = oldBasename.replace(/^E\d+[a-z]?/i, newId);
  const newEpicFile = path.join(epicDir, newBasename);

  // Update frontmatter
  data.data.id = newId;
  saveFile(epicFile, data.data, data.body || '');

  // Rename file
  fs.renameSync(epicFile, newEpicFile);
  results.renamed = { from: epicFile, to: newEpicFile };

  // 2. Update task references (parent field, blocked_by)
  // Use artefacts.ts contract with scope filtering
  const scopeDirs = getScopeDirs(scope, prdDir);
  const scopeDirSet = new Set(scopeDirs);

  for (const taskEntry of getAllTasks()) {
    // Filter by scope
    const taskPrdDir = path.dirname(path.dirname(taskEntry.file));
    if (!scopeDirSet.has(taskPrdDir)) continue;

    const taskData = loadFile(taskEntry.file);
    if (!taskData?.data) continue;

    let modified = false;

    // Update parent field
    if (taskData.data.parent) {
      const newParent = updateEpicRef(taskData.data.parent, oldId, newId);
      if (newParent !== taskData.data.parent) {
        taskData.data.parent = newParent;
        modified = true;
      }
    }

    // Update blocked_by
    if (taskData.data.blocked_by) {
      const newBlockedBy = taskData.data.blocked_by.map(ref =>
        updateEpicRef(ref, oldId, newId)
      );
      if (JSON.stringify(newBlockedBy) !== JSON.stringify(taskData.data.blocked_by)) {
        taskData.data.blocked_by = newBlockedBy;
        modified = true;
      }
    }

    if (modified) {
      saveFile(taskEntry.file, taskData.data, taskData.body || '');
      results.refsUpdated.push(taskEntry.file);
    }
  }

  // Update epic blocked_by references (artefacts.ts contract)
  for (const otherEpicEntry of getAllEpics()) {
    // Filter by scope
    if (!scopeDirSet.has(otherEpicEntry.prdDir)) continue;
    if (otherEpicEntry.file === newEpicFile) continue;

    const otherData = loadFile(otherEpicEntry.file);
    if (!otherData?.data?.blocked_by) continue;

    const newBlockedBy = otherData.data.blocked_by.map(ref =>
      updateEpicRef(ref, oldId, newId)
    );
    if (JSON.stringify(newBlockedBy) !== JSON.stringify(otherData.data.blocked_by)) {
      otherData.data.blocked_by = newBlockedBy;
      saveFile(otherEpicEntry.file, otherData.data, otherData.body || '');
      results.refsUpdated.push(otherEpicEntry.file);
    }
  }

  // 3. Rename memory file if exists
  const memoryDir = getMemoryDir();
  if (memoryDir) {
    const memoryIndex = buildMemoryIndex();
    const memEntry = memoryIndex.get(`E${oldKey}`);
    if (memEntry) {
      const oldMemFile = memEntry.file;
      const newMemBasename = path.basename(oldMemFile).replace(/^E\d+[a-z]?/i, newId);
      const newMemFile = path.join(path.dirname(oldMemFile), newMemBasename);

      // Update frontmatter
      const memData = loadFile(oldMemFile);
      if (memData?.data) {
        memData.data.epic = newId;
        saveFile(oldMemFile, memData.data, memData.body || '');
      }

      fs.renameSync(oldMemFile, newMemFile);
      results.memoryRenamed = { from: oldMemFile, to: newMemFile };
    }
  }

  return results;
}

/**
 * Rename a task file and update all references
 * @param {string} taskFile - Path to task file
 * @param {string} newId - New task ID (e.g., T042)
 * @param {string} scope - 'prd' | 'epic' | 'project'
 * @param {string} prdDir - PRD directory containing the task
 * @param {string} epicId - Epic ID of the task (for epic scope)
 */
function renameTask(taskFile, newId, scope, prdDir, epicId) {
  const data = loadFile(taskFile);
  const oldId = data.data.id;

  const results = {
    renamed: null,
    refsUpdated: [],
    errors: []
  };

  // 1. Rename task file
  const taskDir = path.dirname(taskFile);
  const oldBasename = path.basename(taskFile);
  const newBasename = oldBasename.replace(/^T\d+[a-z]?/i, newId);
  const newTaskFile = path.join(taskDir, newBasename);

  // Update frontmatter
  data.data.id = newId;
  saveFile(taskFile, data.data, data.body || '');

  // Rename file
  fs.renameSync(taskFile, newTaskFile);
  results.renamed = { from: taskFile, to: newTaskFile };

  // 2. Update blocked_by references in other tasks (artefacts.ts contract)
  const scopeDirs = getScopeDirs(scope, prdDir, epicId);
  const scopeDirSet = new Set(scopeDirs);

  for (const otherTaskEntry of getAllTasks()) {
    // Filter by scope
    const otherPrdDir = path.dirname(path.dirname(otherTaskEntry.file));
    if (!scopeDirSet.has(otherPrdDir)) continue;
    if (otherTaskEntry.file === newTaskFile) continue;

    const otherData = loadFile(otherTaskEntry.file);
    if (!otherData?.data?.blocked_by) continue;

    // Filter by epic scope if needed
    if (scope === 'epic' && epicId) {
      const otherParent = otherData.data.parent || '';
      const otherEpicMatch = otherParent.match(/E\d+/i);
      const otherEpicId = otherEpicMatch ? otherEpicMatch[0].toUpperCase() : null;
      if (extractNumericKey(otherEpicId) !== extractNumericKey(epicId)) continue;
    }

    const newBlockedBy = otherData.data.blocked_by.map(ref =>
      updateTaskRef(ref, oldId, newId)
    );
    if (JSON.stringify(newBlockedBy) !== JSON.stringify(otherData.data.blocked_by)) {
      otherData.data.blocked_by = newBlockedBy;
      saveFile(otherTaskEntry.file, otherData.data, otherData.body || '');
      results.refsUpdated.push(otherTaskEntry.file);
    }
  }

  return results;
}

/**
 * Get directories to search based on scope
 */
function getScopeDirs(scope, prdDir, epicId = null) {
  if (scope === 'project') {
    return findPrdDirs();
  }
  // 'prd' or 'epic' scope - only the containing PRD
  return [prdDir];
}

/**
 * Update epic reference in a string (format-agnostic)
 */
function updateEpicRef(str, oldId, newId) {
  const oldKey = extractNumericKey(oldId);
  // Match E followed by any number of digits that resolve to the same key
  const regex = new RegExp(`\\bE0*(${oldKey})\\b`, 'gi');
  return str.replace(regex, newId);
}

/**
 * Update task reference in a string (format-agnostic)
 */
function updateTaskRef(str, oldId, newId) {
  const oldKey = extractNumericKey(oldId);
  // Match T followed by any number of digits that resolve to the same key
  const regex = new RegExp(`\\bT0*(${oldKey})\\b`, 'gi');
  return str.replace(regex, newId);
}

/**
 * Parse a path like "PRD-001/E001" or "PRD-001/T042"
 */
function parsePath(pathStr) {
  const match = pathStr.match(/^(PRD-?\d+)\/(E|T)(\d+[a-z]?)$/i);
  if (!match) return null;

  const prdId = normalizeId(match[1]);
  const type = match[2].toUpperCase();
  const id = formatId(type, parseInt(match[3], 10));

  return { prdId, type, id };
}

/**
 * Find item by PRD/ID path
 */
function findByPath(pathStr, epicIndex, taskIndex) {
  const parsed = parsePath(pathStr);
  if (!parsed) return null;

  const index = parsed.type === 'E' ? epicIndex : taskIndex;
  const key = extractNumericKey(parsed.id);
  const items = index.get(key) || [];

  return items.find(item =>
    normalizeId(item.prdId) === parsed.prdId
  );
}

/**
 * Register renumber commands
 */
export function registerRenumberCommands(program) {
  const renumber = program
    .command('renumber')
    .description('Detect and fix duplicate epic/task IDs')
    .option('--check', 'Only check for duplicates, don\'t fix')
    .option('--fix', 'Auto-fix duplicates (keep oldest)')
    .option('--keep <path>', 'Explicit path to keep (e.g., PRD-001/E001)')
    .option('--scope <scope>', 'Scope for reference updates: prd (default), epic, project', 'prd')
    .option('--path', 'Show file paths (debug)')
    .option('--json', 'Output in JSON format')
    .argument('[target]', 'ID to fix (e.g., E001) or path to rename (e.g., PRD-002/E001)')
    .argument('[newId]', 'New ID for manual rename (e.g., E042)')
    .action((target, newId, options) => {
      const epicIndex = buildEpicIndexForDuplicates();
      const taskIndex = buildTaskIndexForDuplicates();

      const epicDupes = findDuplicates(epicIndex);
      const taskDupes = findDuplicates(taskIndex);

      // Detect target type early
      const isPath = target && target.includes('/');
      const isId = target && !isPath && getEntityType(target);

      // Validate --keep format early - stop if invalid
      let keepParsedGlobal = null;
      if (options.keep) {
        keepParsedGlobal = parsePath(options.keep);
        if (!keepParsedGlobal) {
          console.error(`✗ --keep invalide: "${options.keep}"`);
          console.error(`  Format attendu: PRD-NNN/ENNN ou PRD-NNN/TNNN`);
          console.error(`  Exemple: --keep PRD-001/E001`);
          process.exit(1);
        }

        // Check if --keep matches any duplicate
        const keepType = keepParsedGlobal.type === 'E' ? 'epic' : 'task';
        const keepKey = extractNumericKey(keepParsedGlobal.id);
        const relevantDupes = keepType === 'epic' ? epicDupes : taskDupes;
        const matchingDupe = relevantDupes.find(d => d.key === keepKey);

        if (!matchingDupe) {
          console.error(`✗ --keep "${options.keep}" ne correspond à aucun doublon`);
          console.error(`  Vérifiez que l'ID existe et a des doublons`);
          process.exit(1);
        }

        const matchingItem = matchingDupe.items.find(i => normalizeId(i.prdId) === keepParsedGlobal.prdId);
        if (!matchingItem) {
          console.error(`✗ --keep "${options.keep}" : PRD non trouvé dans les doublons`);
          console.error(`  PRDs disponibles pour ${keepParsedGlobal.id}:`);
          matchingDupe.items.forEach(i => console.error(`    - ${i.prdId}/${i.id}`));
          process.exit(1);
        }
      }

      // --check: just report duplicates (global if no target)
      if (options.check && !isId) {
        if (options.json) {
          jsonOut({
            epics: epicDupes.map(d => ({
              key: d.key,
              items: d.items.map(i => ({
                id: i.id,
                prd: i.prdId,
                file: i.file,
                created: i.created.toISOString()
              }))
            })),
            tasks: taskDupes.map(d => ({
              key: d.key,
              items: d.items.map(i => ({
                id: i.id,
                prd: i.prdId,
                file: i.file,
                created: i.created.toISOString()
              }))
            }))
          });
        } else {
          if (epicDupes.length === 0 && taskDupes.length === 0) {
            console.log('✓ No duplicates found');
            return;
          }

          let epicRenameOffset = 0;
          let taskRenameOffset = 0;

          if (epicDupes.length > 0) {
            console.log(`\n⚠ ${epicDupes.length} duplicate epic ID(s):\n`);
            for (const dupe of epicDupes) {
              // Determine which to keep (same logic as --fix)
              let keepItem = dupe.items[0]; // oldest by default
              if (options.keep) {
                const keepParsed = parsePath(options.keep);
                if (keepParsed && extractNumericKey(keepParsed.id) === dupe.key) {
                  const found = dupe.items.find(i => normalizeId(i.prdId) === keepParsed.prdId);
                  if (found) keepItem = found;
                }
              }

              console.log(`  Key "${dupe.key}":`);
              for (const item of dupe.items) {
                const isKeep = item === keepItem;
                if (isKeep) {
                  console.log(`    ${item.prdId}/${item.id} (${item.created.toISOString().split('T')[0]}) → keep`);
                } else {
                  const futureId = previewNextId('E', epicRenameOffset);
                  console.log(`    ${item.prdId}/${item.id} (${item.created.toISOString().split('T')[0]}) → rename to ${futureId}*`);
                  epicRenameOffset++;
                }
              }
            }
          }

          if (taskDupes.length > 0) {
            console.log(`\n⚠ ${taskDupes.length} duplicate task ID(s):\n`);
            for (const dupe of taskDupes) {
              // Determine which to keep (same logic as --fix)
              let keepItem = dupe.items[0]; // oldest by default
              if (options.keep) {
                const keepParsed = parsePath(options.keep);
                if (keepParsed && extractNumericKey(keepParsed.id) === dupe.key) {
                  const found = dupe.items.find(i => normalizeId(i.prdId) === keepParsed.prdId);
                  if (found) keepItem = found;
                }
              }

              console.log(`  Key "${dupe.key}":`);
              for (const item of dupe.items) {
                const isKeep = item === keepItem;
                if (isKeep) {
                  console.log(`    ${item.prdId}/${item.id} (${item.created.toISOString().split('T')[0]}) → keep`);
                } else {
                  const futureId = previewNextId('T', taskRenameOffset);
                  console.log(`    ${item.prdId}/${item.id} (${item.created.toISOString().split('T')[0]}) → rename to ${futureId}*`);
                  taskRenameOffset++;
                }
              }
            }
          }

          if (epicRenameOffset > 0 || taskRenameOffset > 0) {
            console.log(`\n* ID provisoire, l'ID définitif sera attribué au moment du --fix`);
          }
          console.log('\nRun with --fix to auto-renumber duplicates');
        }
        return;
      }

      // Manual rename: path and newId provided (e.g., rudder renumber PRD-002/E001 E042)
      if (isPath && newId) {
        const item = findByPath(target, epicIndex, taskIndex);
        if (!item) {
          console.error(`Not found: ${target}`);
          process.exit(1);
        }

        const type = getEntityType(item.id);
        const normalizedNewId = normalizeId(newId);

        let results;
        if (type === 'epic') {
          results = renameEpic(item.file, normalizedNewId, options.scope, item.prdDir);
        } else {
          results = renameTask(item.file, normalizedNewId, options.scope, item.prdDir, item.epicId);
        }

        if (options.json) {
          jsonOut(results);
        } else {
          console.log(`✓ Renamed ${item.id} → ${normalizedNewId}`);
          if (options.path) console.log(`  File: ${results.renamed.to}`);
          if (results.refsUpdated.length > 0) {
            console.log(`  Updated ${results.refsUpdated.length} reference(s)`);
          }
          if (options.path && results.memoryRenamed) {
            console.log(`  Memory: ${results.memoryRenamed.to}`);
          }
        }
        return;
      }

      // Targeted check/fix: ID provided (e.g., rudder renumber E001 --check)
      if (isId) {
        const targetKey = extractNumericKey(target);
        const type = getEntityType(target);

        // Filter duplicates to only this ID
        const filteredEpicDupes = type === 'epic'
          ? epicDupes.filter(d => d.key === targetKey)
          : [];
        const filteredTaskDupes = type === 'task'
          ? taskDupes.filter(d => d.key === targetKey)
          : [];

        if (options.check) {
          if (filteredEpicDupes.length === 0 && filteredTaskDupes.length === 0) {
            console.log(`✓ No duplicates for ${target}`);
            return;
          }

          const dupes = type === 'epic' ? filteredEpicDupes : filteredTaskDupes;
          const prefix = type === 'epic' ? 'E' : 'T';
          let renameOffset = 0;

          for (const dupe of dupes) {
            // Determine which to keep (same logic as --fix)
            let keepItem = dupe.items[0]; // oldest by default
            if (options.keep) {
              const keepParsed = parsePath(options.keep);
              if (keepParsed) {
                const found = dupe.items.find(i => normalizeId(i.prdId) === keepParsed.prdId);
                if (found) keepItem = found;
              }
            }

            console.log(`\n⚠ Duplicate ${type} ID "${dupe.key}":\n`);
            for (const item of dupe.items) {
              const isKeep = item === keepItem;
              if (isKeep) {
                console.log(`  ${item.prdId}/${item.id} (${item.created.toISOString().split('T')[0]}) → keep`);
              } else {
                const futureId = previewNextId(prefix, renameOffset);
                console.log(`  ${item.prdId}/${item.id} (${item.created.toISOString().split('T')[0]}) → rename to ${futureId}*`);
                renameOffset++;
              }
            }
          }
          console.log(`\n* ID provisoire, l'ID définitif sera attribué au moment du --fix`);
          console.log(`\nRun with --fix to renumber: rudder renumber ${target} --fix`);
          return;
        }

        if (options.fix) {
          const dupes = type === 'epic' ? filteredEpicDupes : filteredTaskDupes;
          const index = type === 'epic' ? epicIndex : taskIndex;

          if (dupes.length === 0) {
            console.log(`✓ No duplicates for ${target}`);
            return;
          }

          const allResults = [];

          for (const dupe of dupes) {
            let keepItem = dupe.items[0]; // oldest by default

            if (options.keep) {
              const keepParsed = parsePath(options.keep);
              if (keepParsed) {
                const found = dupe.items.find(i => normalizeId(i.prdId) === keepParsed.prdId);
                if (found) keepItem = found;
              }
            }

            for (const item of dupe.items) {
              if (item === keepItem) continue;

              const prefix = type === 'epic' ? 'E' : 'T';
              const newId = getNextAvailableId(prefix);

              let results;
              if (type === 'epic') {
                results = renameEpic(item.file, newId, options.scope, item.prdDir);
              } else {
                results = renameTask(item.file, newId, options.scope, item.prdDir, item.epicId);
              }

              // Update index
              index.set(extractNumericKey(newId), [{
                ...item,
                id: newId,
                file: results.renamed.to
              }]);

              allResults.push({
                type,
                oldId: item.id,
                newId,
                prd: item.prdId,
                ...results
              });

              if (!options.json) {
                console.log(`✓ ${item.prdId}/${item.id} → ${newId}`);
              }
            }
          }

          if (options.json) {
            jsonOut({ fixed: allResults });
          } else if (allResults.length > 0) {
            console.log(`\n✓ Fixed ${allResults.length} duplicate(s) for ${target}`);
          }
          return;
        }
      }

      // --fix: auto-fix all duplicates (global if no target ID)
      if (options.fix && !isId) {
        if (epicDupes.length === 0 && taskDupes.length === 0) {
          console.log('✓ No duplicates to fix');
          return;
        }

        const allResults = [];

        // Fix epic duplicates
        for (const dupe of epicDupes) {
          // Determine which to keep
          let keepItem = dupe.items[0]; // oldest by default

          if (options.keep) {
            const keepParsed = parsePath(options.keep);
            if (keepParsed && extractNumericKey(keepParsed.id) === dupe.key) {
              const found = dupe.items.find(i => normalizeId(i.prdId) === keepParsed.prdId);
              if (found) keepItem = found;
            }
          }

          // Rename all others
          for (const item of dupe.items) {
            if (item === keepItem) continue;

            const newId = getNextAvailableId('E');
            const results = renameEpic(item.file, newId, options.scope, item.prdDir);

            // Update index to reflect new ID
            epicIndex.set(extractNumericKey(newId), [{
              ...item,
              id: newId,
              file: results.renamed.to
            }]);

            allResults.push({
              type: 'epic',
              oldId: item.id,
              newId,
              prd: item.prdId,
              ...results
            });

            if (!options.json) {
              console.log(`✓ ${item.prdId}/${item.id} → ${newId}`);
            }
          }
        }

        // Fix task duplicates
        for (const dupe of taskDupes) {
          let keepItem = dupe.items[0];

          if (options.keep) {
            const keepParsed = parsePath(options.keep);
            if (keepParsed && extractNumericKey(keepParsed.id) === dupe.key) {
              const found = dupe.items.find(i => normalizeId(i.prdId) === keepParsed.prdId);
              if (found) keepItem = found;
            }
          }

          for (const item of dupe.items) {
            if (item === keepItem) continue;

            const newId = getNextAvailableId('T');
            const results = renameTask(item.file, newId, options.scope, item.prdDir, item.epicId);

            taskIndex.set(extractNumericKey(newId), [{
              ...item,
              id: newId,
              file: results.renamed.to
            }]);

            allResults.push({
              type: 'task',
              oldId: item.id,
              newId,
              prd: item.prdId,
              ...results
            });

            if (!options.json) {
              console.log(`✓ ${item.prdId}/${item.id} → ${newId}`);
            }
          }
        }

        if (options.json) {
          jsonOut({ fixed: allResults });
        } else if (allResults.length > 0) {
          console.log(`\n✓ Fixed ${allResults.length} duplicate(s)`);
        }
        return;
      }

      // No action specified, show help
      console.log('Usage:');
      console.log('  rudder renumber --check                        # Detect all duplicates');
      console.log('  rudder renumber --fix                          # Auto-fix all duplicates');
      console.log('  rudder renumber E001 --check                   # Check specific ID');
      console.log('  rudder renumber E001 --fix                     # Fix specific ID');
      console.log('  rudder renumber E001 --fix --keep PRD-001/E001 # Keep specific one');
      console.log('  rudder renumber PRD-001/E001 E042              # Manual rename');
      console.log('');
      console.log('Options:');
      console.log('  --scope prd     Update refs only in same PRD (default)');
      console.log('  --scope project Update refs across entire project');
    });
}
