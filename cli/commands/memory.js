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
  mergeTaskLog,
  prdMemoryFilePath,
  prdMemoryExists,
  createPrdMemoryFile,
  projectMemoryFilePath,
  projectMemoryExists,
  getHierarchicalMemory,
  findEpicPrd
} from '../lib/memory.js';

/**
 * Register memory commands
 */
export function registerMemoryCommands(program) {
  const memory = program.command('memory').description('Memory operations (logs, consolidation)');

  addDynamicHelp(memory, { entityType: 'memory' });

  // memory:show <ID> - unified memory display (hierarchical: project → PRD → epic)
  memory.command('show <id>')
    .description('Show memory for any entity (hierarchical: project → PRD → epic)')
    .option('--full', 'Show full memory (all sections)')
    .option('--epic-only', 'Show only epic memory (skip PRD/project)')
    .option('--json', 'JSON output')
    .action((id, options) => {
      ensureMemoryDir();

      const normalized = normalizeId(id);

      // Get hierarchical memory
      const hierarchy = getHierarchicalMemory(normalized);

      if (!hierarchy.epic && !hierarchy.prd && !hierarchy.project) {
        if (options.json) {
          jsonOut({ id: normalized, exists: false, hierarchy: null });
        } else {
          console.log(`No memory for ${normalized}`);
        }
        return;
      }

      // Helper to extract Agent Context section
      const extractAgentContext = (content) => {
        const match = content.match(/## Agent Context\s*([\s\S]*?)(?=\n## |$)/);
        if (!match) return '';
        return match[1].replace(/<!--[\s\S]*?-->/g, '').trim();
      };

      // Helper to extract relevant sections from PRD memory
      const extractPrdContext = (content) => {
        const match = content.match(/## Cross-Epic Patterns\s*([\s\S]*?)(?=\n## |$)/);
        if (!match) return '';
        return match[1].replace(/<!--[\s\S]*?-->/g, '').trim();
      };

      // Helper to extract relevant sections from Project memory
      const extractProjectContext = (content) => {
        const sections = [];
        const archMatch = content.match(/## Architecture Decisions\s*([\s\S]*?)(?=\n## |$)/);
        const patternMatch = content.match(/## Patterns & Conventions\s*([\s\S]*?)(?=\n## |$)/);
        if (archMatch) {
          const cleaned = archMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim();
          if (cleaned) sections.push(cleaned);
        }
        if (patternMatch) {
          const cleaned = patternMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim();
          if (cleaned) sections.push(cleaned);
        }
        return sections.join('\n\n');
      };

      if (options.json) {
        const result = {
          id: normalized,
          exists: true,
          full: options.full || false
        };
        if (hierarchy.project) {
          result.project = {
            path: hierarchy.project.path,
            content: options.full ? hierarchy.project.content : extractProjectContext(hierarchy.project.content)
          };
        }
        if (hierarchy.prd) {
          result.prd = {
            id: hierarchy.prd.id,
            path: hierarchy.prd.path,
            content: options.full ? hierarchy.prd.content : extractPrdContext(hierarchy.prd.content)
          };
        }
        if (hierarchy.epic) {
          result.epic = {
            id: hierarchy.epic.id,
            path: hierarchy.epic.path,
            content: options.full ? hierarchy.epic.content : extractAgentContext(hierarchy.epic.content)
          };
        }
        jsonOut(result);
        return;
      }

      // Human-readable output
      if (options.full) {
        // Show full content of all levels
        if (hierarchy.project && !options.epicOnly) {
          console.log('# Project Memory\n');
          console.log(hierarchy.project.content.trim());
          console.log('\n---\n');
        }
        if (hierarchy.prd && !options.epicOnly) {
          console.log(`# PRD Memory: ${hierarchy.prd.id}\n`);
          console.log(hierarchy.prd.content.trim());
          console.log('\n---\n');
        }
        if (hierarchy.epic) {
          console.log(`# Epic Memory: ${hierarchy.epic.id}\n`);
          console.log(hierarchy.epic.content.trim());
        }
      } else {
        // Show Agent Context sections only
        const sections = [];

        if (hierarchy.project && !options.epicOnly) {
          const ctx = extractProjectContext(hierarchy.project.content);
          if (ctx) sections.push({ level: 'Project', content: ctx });
        }
        if (hierarchy.prd && !options.epicOnly) {
          const ctx = extractPrdContext(hierarchy.prd.content);
          if (ctx) sections.push({ level: `PRD ${hierarchy.prd.id}`, content: ctx });
        }
        if (hierarchy.epic) {
          const ctx = extractAgentContext(hierarchy.epic.content);
          if (ctx) sections.push({ level: `Epic ${hierarchy.epic.id}`, content: ctx });
        }

        if (sections.length === 0) {
          console.log(`No agent context for ${normalized}`);
          return;
        }

        console.log(`# Memory Context: ${normalized}\n`);
        for (const { level, content } of sections) {
          console.log(`## ${level}\n`);
          console.log(content);
          console.log('');
        }
      }
    });

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

        // Create epic .md if missing (unless --no-create)
        if (!mdExists && options.create !== false) {
          createMemoryFile(epicId);
          createdMd++;
        }

        // Create PRD .md if missing (unless --no-create)
        const prdId = findEpicPrd(epicId);
        if (prdId && !prdMemoryExists(prdId) && options.create !== false) {
          createPrdMemoryFile(prdId);
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

      // Step 3: Collect all memory files (epic, prd, project)
      const memDir = getMemoryDirPath();
      const allMemoryFiles = fs.existsSync(memDir)
        ? fs.readdirSync(memDir).filter(f => f.endsWith('.md'))
        : [];

      // Epic memory files
      const epicMemoryFiles = allMemoryFiles
        .filter(f => f.startsWith('E'))
        .map(f => {
          const epicId = f.replace('.md', '');
          const filePath = memoryFilePath(epicId);
          const content = fs.readFileSync(filePath, 'utf8');
          const prdId = findEpicPrd(epicId);
          return { id: epicId, path: filePath, prdId, content };
        });

      // Ensure PRD memory exists for each epic's PRD (unless --no-create)
      if (options.create !== false) {
        const prdIds = new Set(epicMemoryFiles.map(e => e.prdId).filter(Boolean));
        for (const prdId of prdIds) {
          if (!prdMemoryExists(prdId)) {
            createPrdMemoryFile(prdId);
            createdMd++;
          }
        }
      }

      // Re-read PRD memory files (may have been created above)
      const updatedMemoryFiles = fs.existsSync(memDir)
        ? fs.readdirSync(memDir).filter(f => f.endsWith('.md'))
        : [];

      // PRD memory files
      const prdMemoryFiles = updatedMemoryFiles
        .filter(f => f.startsWith('PRD-'))
        .map(f => {
          const prdId = f.replace('.md', '');
          const filePath = prdMemoryFilePath(prdId);
          const content = fs.readFileSync(filePath, 'utf8');
          return { id: prdId, path: filePath, content };
        });

      // Project memory file
      const projectMemoryFile = projectMemoryExists()
        ? {
            path: projectMemoryFilePath(),
            content: fs.readFileSync(projectMemoryFilePath(), 'utf8')
          }
        : null;

      // No pending logs
      const hasPendingLogs = epicLogs.length > 0;

      if (options.json) {
        jsonOut({
          pending: hasPendingLogs,
          mergedTasks,
          deletedEmpty,
          createdMd,
          logs: epicLogs.map(e => ({
            id: e.id,
            lines: e.lines,
            entries: e.entries,
            levels: e.levels,
            hasMd: e.hasMd,
            content: e.content
          })),
          memory: {
            epics: epicMemoryFiles.map(e => ({ id: e.id, prdId: e.prdId, path: e.path })),
            prds: prdMemoryFiles.map(p => ({ id: p.id, path: p.path })),
            project: projectMemoryFile ? { path: projectMemoryFile.path } : null
          }
        });
        return;
      }

      // Human-readable output
      if (mergedTasks > 0) console.log(`Merged: ${mergedTasks} task logs → epic logs`);
      if (deletedEmpty > 0) console.log(`Deleted: ${deletedEmpty} empty logs`);
      if (createdMd > 0) console.log(`Created: ${createdMd} memory files`);

      // Show pending logs if any
      if (hasPendingLogs) {
        console.log(`\n⚠ PENDING LOGS: ${epicLogs.length} epic(s)\n`);
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
      } else {
        console.log('✓ No pending logs');
      }

      // Show memory files hierarchy
      console.log('\n' + '='.repeat(60));
      console.log('\n# Memory Files\n');

      // Project level
      console.log('## Project');
      if (projectMemoryFile) {
        console.log(`  ✓ ${projectMemoryFile.path}`);
      } else {
        console.log('  ○ No project memory (run install.sh or devinstall.sh)');
      }

      // PRD level
      console.log('\n## PRD');
      if (prdMemoryFiles.length === 0) {
        console.log('  ○ No PRD memories');
      } else {
        for (const prd of prdMemoryFiles) {
          console.log(`  ✓ ${prd.id}`);
        }
      }

      // Epic level
      console.log('\n## Epic');
      if (epicMemoryFiles.length === 0) {
        console.log('  ○ No epic memories');
      } else {
        for (const epic of epicMemoryFiles) {
          const prdRef = epic.prdId ? ` (${epic.prdId})` : '';
          console.log(`  ✓ ${epic.id}${prdRef}`);
        }
      }

      // Escalation brief (only when there are pending logs)
      if (hasPendingLogs) {
        console.log('\n' + '='.repeat(60));
        console.log('\n# Escalation Guide\n');
        console.log('## Consolidation');
        console.log('1. Read pending logs above');
        console.log('2. Edit epic memory files:');
        console.log('   - [TIP] → ## Agent Context');
        console.log('   - [ERROR/CRITICAL] → ## Escalation');
        console.log('   - [INFO/WARN] → ## Story (optional)');
        console.log('3. After editing: rudder epic:clean-logs <epic>');
        console.log('\n## When to Escalate');
        console.log('- Same tip in 2+ epics → reformulate in PRD memory');
        console.log('- Same pattern in 2+ PRDs → reformulate in Project memory');
        console.log('- Architecture decision → document in Project immediately');
        console.log('\n## Escalation = Reformulation');
        console.log('Never copy-paste. Reformulate into higher-level insight.');
        console.log('Remove duplicates from lower levels after escalation.');
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
