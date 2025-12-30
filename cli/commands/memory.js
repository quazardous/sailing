/**
 * Memory commands for rudder CLI
 */
import fs from 'fs';
import { jsonOut, findPrdDirs, findFiles } from '../lib/core.js';
import { normalizeId } from '../lib/normalize.js';
import { addDynamicHelp } from '../lib/help.js';
import {
  getMemoryDirPath,
  ensureMemoryDir,
  logFilePath,
  memoryFilePath,
  memoryFileExists,
  readLogFile,
  findLogFiles,
  findTaskEpic,
  parseLogLevels,
  createMemoryFile,
  mergeTaskLog
} from '../lib/memory.js';

/**
 * Register memory commands
 */
export function registerMemoryCommands(program) {
  const memory = program.command('memory').description('Memory operations (logs, consolidation)');

  addDynamicHelp(memory, { entityType: 'memory' });

  // memory:sync [ID] - merge task→epic logs, show content, create missing .md
  memory.command('sync')
    .description('Merge task→epic logs, show pending content')
    .argument('[id]', 'Epic (ENNN) or Task (TNNN) ID - filters to that epic')
    .option('--no-create', 'Do not create missing memory (.md) files')
    .option('--json', 'JSON output')
    .action((id, options) => {
      ensureMemoryDir();

      // Resolve target epic if ID provided
      let targetEpicId = null;
      if (id) {
        const normalized = normalizeId(id);
        if (normalized.startsWith('E')) {
          targetEpicId = normalized;
        } else if (normalized.startsWith('T')) {
          const taskInfo = findTaskEpic(normalized);
          if (!taskInfo) {
            console.error(`Task ${normalized} not found or has no parent epic`);
            process.exit(1);
          }
          targetEpicId = taskInfo.epicId;
        } else {
          console.error(`Invalid ID: ${id} (expected ENNN or TNNN)`);
          process.exit(1);
        }
      }

      let deletedEmpty = 0;
      let mergedTasks = 0;
      let createdMd = 0;

      // Step 1: Merge all task logs into epic logs
      const taskLogs = findLogFiles().filter(f => f.type === 'task');

      for (const { id: taskId } of taskLogs) {
        // Skip if filtering by epic and this task belongs to different epic
        if (targetEpicId) {
          const taskInfo = findTaskEpic(taskId);
          if (!taskInfo || taskInfo.epicId !== targetEpicId) continue;
        }

        const result = mergeTaskLog(taskId);
        if (result.merged) mergedTasks++;
        if (result.deleted) deletedEmpty++;
      }

      // Step 2: Collect epic logs
      let epicLogFiles = findLogFiles().filter(f => f.type === 'epic');

      // Filter by target epic if specified
      if (targetEpicId) {
        epicLogFiles = epicLogFiles.filter(f => f.id === targetEpicId);
      }

      const epicLogs = [];

      for (const { id: epicId, path: logPath } of epicLogFiles) {
        const content = readLogFile(epicId);

        // Delete empty logs
        if (!content) {
          fs.unlinkSync(logPath);
          deletedEmpty++;
          continue;
        }

        const mdExists = memoryFileExists(epicId);

        // Create .md if missing (unless --no-create)
        if (!mdExists && options.create !== false) {
          createMemoryFile(epicId);
          createdMd++;
        }

        const levels = parseLogLevels(content);
        const totalEntries = Object.values(levels).reduce((a, b) => a + b, 0);

        epicLogs.push({
          id: epicId,
          lines: content.split('\n').length,
          entries: totalEntries,
          levels,
          hasMd: mdExists || (options.create !== false),
          content
        });
      }

      // No pending logs
      if (epicLogs.length === 0) {
        if (options.json) {
          jsonOut({ pending: false, mergedTasks, deletedEmpty, createdMd, epics: [] });
        } else {
          if (mergedTasks > 0) console.log(`Merged: ${mergedTasks} task logs`);
          if (deletedEmpty > 0) console.log(`Deleted: ${deletedEmpty} empty logs`);
          if (createdMd > 0) console.log(`Created: ${createdMd} memory files`);
          console.log('✓ No pending logs');
        }
        return;
      }

      // Has pending logs
      if (options.json) {
        jsonOut({
          pending: true,
          mergedTasks,
          deletedEmpty,
          createdMd,
          epics: epicLogs.map(e => ({
            id: e.id,
            lines: e.lines,
            entries: e.entries,
            levels: e.levels,
            hasMd: e.hasMd,
            content: e.content
          }))
        });
        return;
      }

      // Human-readable output
      console.log(`⚠ MEMORY SYNC REQUIRED\n`);
      if (mergedTasks > 0) console.log(`Merged: ${mergedTasks} task logs → epic logs`);
      if (deletedEmpty > 0) console.log(`Deleted: ${deletedEmpty} empty logs`);
      if (createdMd > 0) console.log(`Created: ${createdMd} memory files`);

      console.log(`\nPending: ${epicLogs.length} epic log(s)\n`);
      console.log('='.repeat(60) + '\n');

      for (const epic of epicLogs) {
        const mdStatus = epic.hasMd ? '✓' : '○ (no .md)';
        console.log(`## ${epic.id} ${mdStatus}`);
        console.log(`   ${epic.lines} lines, ${epic.entries} entries`);
        console.log(`   TIP=${epic.levels.TIP} INFO=${epic.levels.INFO} WARN=${epic.levels.WARN} ERROR=${epic.levels.ERROR} CRITICAL=${epic.levels.CRITICAL}\n`);
        console.log(epic.content);
        console.log('\n---\n');
      }

      console.log('='.repeat(60));
      console.log('\nMapping:');
      console.log('  [TIP]      → Agent Context');
      console.log('  [ERROR]    → Escalation');
      console.log('  [CRITICAL] → Escalation');
      console.log('  [INFO]     → Story');
      console.log('  [WARN]     → Story');

      console.log('\nAfter consolidation:');
      for (const epic of epicLogs) {
        console.log(`  rudder epic:clean-logs ${epic.id}`);
      }
    });

  // memory:escalations - list memory files with escalation content
  memory.command('escalations')
    .description('List memory files with escalations')
    .option('--prd <id>', 'Filter by PRD (PRD-NNN)')
    .option('--epic <id>', 'Filter by epic (ENNN)')
    .option('--json', 'JSON output')
    .action((options) => {
      ensureMemoryDir();

      let files = fs.readdirSync(getMemoryDirPath()).filter(f => f.endsWith('.md') && f.startsWith('E'));

      // Filter by specific epic
      if (options.epic) {
        const epicId = normalizeId(options.epic);
        files = files.filter(f => f.replace('.md', '') === epicId);
      }

      // Filter by PRD - need to check which epics belong to this PRD
      if (options.prd) {
        const prdId = options.prd.toUpperCase();
        const prdEpics = new Set();

        for (const prdDir of findPrdDirs()) {
          if (prdDir.includes(prdId)) {
            const epicsDir = prdDir + '/epics';
            const epicFiles = findFiles(epicsDir, /^E\d+.*\.md$/);
            for (const ef of epicFiles) {
              const match = ef.match(/E\d+/);
              if (match) prdEpics.add(normalizeId(match[0]));
            }
          }
        }

        files = files.filter(f => prdEpics.has(f.replace('.md', '')));
      }
      const results = [];

      for (const file of files) {
        const epicId = file.replace('.md', '');
        const content = fs.readFileSync(memoryFilePath(epicId), 'utf8');

        // Extract Escalation section (between ## Escalation and next ## heading)
        const match = content.match(/## Escalation\s*\n([\s\S]*?)(?=\n## [A-Z])/);
        if (match) {
          const section = match[1].trim();
          // Remove HTML comments
          const cleaned = section.replace(/<!--[\s\S]*?-->/g, '').trim();
          // Get non-empty lines
          const lines = cleaned.split('\n').filter(l => l.trim()).join('\n');

          if (lines) {
            results.push({ id: epicId, escalations: lines });
          }
        }
      }

      if (options.json) {
        jsonOut(results);
        return;
      }

      if (results.length === 0) {
        console.log('✓ No escalations');
        return;
      }

      console.log(`⚠ ${results.length} epic(s) with escalations\n`);
      for (const { id, escalations } of results) {
        console.log(`## ${id}`);
        console.log(escalations);
        console.log('');
      }
    });
}
