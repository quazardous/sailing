/**
 * PRD commands for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, findFiles, loadFile, saveFile, toKebab, jsonOut, getPrdsDir } from '../lib/core.js';
import { matchesPrdDir } from '../lib/normalize.js';
import { STATUS, normalizeStatus, statusSymbol } from '../lib/lexicon.js';
import { nextId } from '../lib/state.js';
import { parseUpdateOptions } from '../lib/update.js';
import { addDynamicHelp } from '../lib/help.js';

/**
 * Register PRD commands
 */
export function registerPrdCommands(program) {
  const prd = program.command('prd').description('PRD operations (product requirements)');

  // Dynamic help generated from registered commands
  addDynamicHelp(prd, { entityType: 'prd' });

  const statusHelp = STATUS.prd.join(', ');

  // prd:list
  prd.command('list')
    .description('List PRDs with epic/task counts')
    .option('-s, --status <status>', `Filter by status (${statusHelp})`)
    .option('-t, --tag <tag>', 'Filter by tag (repeatable, AND logic)', (v, arr) => arr.concat(v), [])
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .option('--json', 'JSON output')
    .action((options) => {
      const prds = [];

      for (const prdDir of findPrdDirs()) {
        const prdFile = path.join(prdDir, 'prd.md');
        const file = loadFile(prdFile);
        if (!file?.data) continue;

        // Status filter
        if (options.status) {
          const targetStatus = normalizeStatus(options.status, 'prd');
          const prdStatus = normalizeStatus(file.data.status, 'prd');
          if (targetStatus !== prdStatus) continue;
        }

        // Tag filter (AND logic)
        if (options.tag?.length > 0) {
          const prdTags = file.data.tags || [];
          const allTagsMatch = options.tag.every(t => prdTags.includes(t));
          if (!allTagsMatch) continue;
        }

        // Count epics and tasks
        const epicsDir = path.join(prdDir, 'epics');
        const tasksDir = path.join(prdDir, 'tasks');
        const epicCount = findFiles(epicsDir, /^E\d+.*\.md$/).length;
        const taskCount = findFiles(tasksDir, /^T\d+.*\.md$/).length;

        prds.push({
          id: file.data.id || path.basename(prdDir).match(/PRD-\d+/)?.[0],
          title: file.data.title || '',
          status: file.data.status || 'Unknown',
          epics: epicCount,
          tasks: taskCount,
          dir: prdDir
        });
      }

      // Sort by ID
      prds.sort((a, b) => {
        const numA = parseInt(a.id?.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.id?.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

      // Apply limit
      const limited = options.limit ? prds.slice(0, options.limit) : prds;

      if (options.json) {
        jsonOut(limited);
      } else {
        if (limited.length === 0) {
          console.log('No PRDs found.');
        } else {
          limited.forEach(p => {
            const sym = statusSymbol(p.status);
            console.log(`${sym} ${p.id}: ${p.title} [${p.status}] (${p.epics} epics, ${p.tasks} tasks)`);
          });
          if (options.limit && prds.length > options.limit) {
            console.log(`\n... and ${prds.length - options.limit} more`);
          }
        }
      }
    });

  // prd:show
  prd.command('show <id>')
    .description('Show PRD details (epics, tasks by status)')
    .option('--raw', 'Dump raw markdown file')
    .option('--json', 'JSON output')
    .action((id, options) => {
      const prdDir = findPrdDirs().find(d => matchesPrdDir(d, id));
      if (!prdDir) {
        console.error(`PRD not found: ${id}`);
        process.exit(1);
      }

      const prdFile = path.join(prdDir, 'prd.md');

      // Raw mode: dump file content with path header
      if (options.raw) {
        console.log(`# File: ${prdFile}\n`);
        console.log(fs.readFileSync(prdFile, 'utf8'));
        return;
      }

      const file = loadFile(prdFile);
      if (!file) {
        console.error(`PRD file not found: ${prdFile}`);
        process.exit(1);
      }

      // Count epics and tasks
      const epicsDir = path.join(prdDir, 'epics');
      const tasksDir = path.join(prdDir, 'tasks');

      const epics = findFiles(epicsDir, /^E\d+.*\.md$/).map(f => {
        const ef = loadFile(f);
        return { id: ef?.data?.id, title: ef?.data?.title, status: ef?.data?.status };
      });

      const tasks = findFiles(tasksDir, /^T\d+.*\.md$/).map(f => {
        const tf = loadFile(f);
        return { id: tf?.data?.id, status: tf?.data?.status };
      });

      const tasksByStatus = {};
      tasks.forEach(t => {
        const status = t.status || 'Unknown';
        tasksByStatus[status] = (tasksByStatus[status] || 0) + 1;
      });

      const output = {
        ...file.data,
        dir: prdDir,
        file: prdFile,
        epicCount: epics.length,
        taskCount: tasks.length,
        epics,
        tasksByStatus
      };

      if (options.json) {
        jsonOut(output);
      } else {
        console.log(`# ${file.data.id}: ${file.data.title}\n`);
        console.log(`Status: ${file.data.status}`);
        console.log(`\nEpics: ${epics.length}`);
        epics.forEach(e => {
          console.log(`  ${statusSymbol(e.status)} ${e.id}: ${e.title}`);
        });
        console.log(`\nTasks: ${tasks.length}`);
        Object.entries(tasksByStatus).forEach(([status, count]) => {
          console.log(`  ${statusSymbol(status)} ${status}: ${count}`);
        });
        console.log(`\nDirectory: ${prdDir}`);
      }
    });

  // prd:create
  prd.command('create <title>')
    .description('Create PRD directory + prd.md (status: Draft)')
    .option('--tag <tag>', 'Add tag (repeatable, slugified to kebab-case)', (v, arr) => arr.concat(v), [])
    .option('--json', 'JSON output')
    .action((title, options) => {
      const num = nextId('prd');
      const id = `PRD-${String(num).padStart(3, '0')}`;
      const dirName = `${id}-${toKebab(title)}`;
      const prdsDir = getPrdsDir();
      const prdDir = path.join(prdsDir, dirName);

      if (!fs.existsSync(prdsDir)) {
        fs.mkdirSync(prdsDir, { recursive: true });
      }

      fs.mkdirSync(prdDir);
      fs.mkdirSync(path.join(prdDir, 'epics'));
      fs.mkdirSync(path.join(prdDir, 'tasks'));

      const data = {
        id,
        title,
        status: 'Draft',
        tags: []
      };

      // Add tags if specified (slugified to kebab-case)
      if (options.tag?.length > 0) {
        data.tags = options.tag.map(t => toKebab(t));
      }

      const body = `\n# ${id}: ${title}\n\n## Problem Statement\n\n[Describe the problem]\n\n## Goals\n\n- [Goal 1]\n\n## Non-Goals\n\n- [Non-goal 1]\n\n## Solution Overview\n\n[High-level approach]\n`;

      const prdFile = path.join(prdDir, 'prd.md');
      saveFile(prdFile, data, body);

      if (options.json) {
        jsonOut({ id, title, dir: prdDir, file: prdFile });
      } else {
        console.log(`Created: ${id} - ${title}`);
        console.log(`Directory: ${prdDir}`);
      }
    });

  // prd:update
  prd.command('update <id>')
    .description('Update PRD (status, title)')
    .option('-s, --status <status>', `Set status (${statusHelp})`)
    .option('-t, --title <title>', 'Set title')
    .option('--set <key=value>', 'Set any frontmatter field (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--json', 'JSON output')
    .action((id, options) => {
      const prdDir = findPrdDirs().find(d => matchesPrdDir(d, id));
      if (!prdDir) {
        console.error(`PRD not found: ${id}`);
        process.exit(1);
      }

      const prdFile = path.join(prdDir, 'prd.md');
      const file = loadFile(prdFile);
      if (!file) {
        console.error(`PRD file not found: ${prdFile}`);
        process.exit(1);
      }

      const opts = {
        status: options.status,
        title: options.title,
        set: options.set?.length ? options.set : null
      };

      const { updated, data } = parseUpdateOptions(opts, file.data, 'prd');

      if (updated) {
        saveFile(prdFile, data, file.body);
        if (options.json) {
          jsonOut(data);
        } else {
          console.log(`Updated: ${data.id}`);
        }
      } else {
        console.log('No changes made.');
      }
    });

  // prd:milestone
  prd.command('milestone <prd-id> <milestone-id>')
    .description('Manage PRD milestone (add/remove epics)')
    .option('--add-epic <epic>', 'Add epic to milestone (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--remove-epic <epic>', 'Remove epic from milestone (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--json', 'JSON output')
    .action((prdId, milestoneId, options) => {
      const prdDir = findPrdDirs().find(d => matchesPrdDir(d, prdId));
      if (!prdDir) {
        console.error(`PRD not found: ${prdId}`);
        process.exit(1);
      }

      const prdFile = path.join(prdDir, 'prd.md');
      const file = loadFile(prdFile);
      if (!file) {
        console.error(`PRD file not found: ${prdFile}`);
        process.exit(1);
      }

      // Ensure milestones array exists
      if (!file.data.milestones) {
        file.data.milestones = [];
      }

      // Find or create milestone
      let milestone = file.data.milestones.find(m => m.id === milestoneId);
      if (!milestone) {
        milestone = { id: milestoneId, epics: [] };
        file.data.milestones.push(milestone);
      }

      // Ensure epics array exists
      if (!milestone.epics) {
        milestone.epics = [];
      }

      let updated = false;
      const added = [];
      const removed = [];
      const skipped = [];

      // Add epics
      for (const epic of options.addEpic || []) {
        const epicId = epic.toUpperCase();
        if (milestone.epics.includes(epicId)) {
          skipped.push(epicId);
        } else {
          milestone.epics.push(epicId);
          added.push(epicId);
          updated = true;
        }
      }

      // Remove epics
      for (const epic of options.removeEpic || []) {
        const epicId = epic.toUpperCase();
        const idx = milestone.epics.indexOf(epicId);
        if (idx >= 0) {
          milestone.epics.splice(idx, 1);
          removed.push(epicId);
          updated = true;
        } else {
          skipped.push(epicId);
        }
      }

      // Sort epics for consistency
      milestone.epics.sort();

      if (updated) {
        saveFile(prdFile, file.data, file.body);
      }

      const result = {
        prd: file.data.id,
        milestone: milestoneId,
        epics: milestone.epics,
        added,
        removed,
        skipped,
        updated
      };

      if (options.json) {
        jsonOut(result);
      } else {
        if (!updated && added.length === 0 && removed.length === 0) {
          console.log(`Milestone ${milestoneId}: ${milestone.epics.join(', ') || '(no epics)'}`);
        } else {
          if (added.length > 0) {
            console.log(`Added to ${milestoneId}: ${added.join(', ')}`);
          }
          if (removed.length > 0) {
            console.log(`Removed from ${milestoneId}: ${removed.join(', ')}`);
          }
          if (skipped.length > 0) {
            console.log(`Skipped (no change): ${skipped.join(', ')}`);
          }
          console.log(`${milestoneId} epics: ${milestone.epics.join(', ') || '(none)'}`);
        }
      }
    });
}
