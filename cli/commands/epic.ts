/**
 * Epic commands for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, saveFile, toKebab, loadTemplate, jsonOut, getMemoryDir, stripComments } from '../managers/core-manager.js';
import { normalizeId, matchesPrdDir } from '../lib/normalize.js';
import { STATUS, normalizeStatus, statusSymbol } from '../lib/lexicon.js';
import { nextId } from '../managers/state-manager.js';
import { parseUpdateOptions } from '../lib/update.js';
import { addDynamicHelp, withModifies } from '../lib/help.js';
import { formatId } from '../managers/core-manager.js';
import { parseSearchReplace, editArtifact, parseMultiSectionContent, processMultiSectionOps } from '../lib/artifact.js';
import { getEpic, getAllEpics, getTasksForEpic } from '../managers/artefacts-manager.js';
import { Epic } from '../lib/types/entities.js';
import { getEpicMemory } from '../managers/memory-manager.js';
import { Command } from 'commander';

interface EpicListOptions {
  status?: string;
  tag?: string[];
  limit?: number;
  prd?: string;
  path?: boolean;
  json?: boolean;
}

interface EpicUpdateOptions {
  status?: string;
  title?: string;
  assignee?: string;
  addBlocker?: string[];
  removeBlocker?: string[];
  clearBlockers?: boolean;
  story?: string[];
  addStory?: string[];
  removeStory?: string[];
  targetVersion?: string[];
  removeTargetVersion?: string[];
  set?: string[];
  json?: boolean;
}

interface EpicEditOptions {
  section?: string;
  content?: string;
  append?: boolean;
  prepend?: boolean;
  json?: boolean;
}

interface EpicCreateOptions {
  story?: string[];
  tag?: string[];
  targetVersion?: string[];
  path?: boolean;
  json?: boolean;
}

/**
 * Find an epic file by ID (format-agnostic via index library)
 * Returns { file, prdDir } for compatibility with existing code
 */
function findEpicFile(epicId) {
  const epic = getEpic(epicId);
  if (!epic) return null;
  return { file: epic.file, prdDir: epic.prdDir };
}

/**
 * Register epic commands
 */
export function registerEpicCommands(program: Command) {
  const epic = program.command('epic').description('Epic operations (groups of tasks)') as Command;

  // Dynamic help generated from registered commands
  addDynamicHelp(epic, { entityType: 'epic' });

  const statusHelp = STATUS.epic.join(', ');

  // epic:list
  epic.command('list [prd]')
    .description('List epics (filter by PRD, status, tag)')
    .option('-s, --status <status>', `Filter by status (${statusHelp})`)
    .option('-t, --tag <tag>', 'Filter by tag (repeatable, AND logic)', (v, arr) => arr.concat(v), [])
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .option('--prd <id>', 'Filter by PRD (alias for positional arg)')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((prdArg: string, options: EpicListOptions) => {
      const prd = prdArg || options.prd;
      const epics: (Epic & { file?: string; prd: string; tasks: number })[] = [];

      // Use artefacts.ts contract - single entry point
      for (const epicEntry of getAllEpics()) {
        // PRD filter
        if (prd && !matchesPrdDir(epicEntry.prdDir, prd)) continue;

        const data = epicEntry.data;
        if (!data) continue;

        // Status filter
        if (options.status) {
          const targetStatus = normalizeStatus(options.status, 'epic');
          const epicStatus = normalizeStatus(data.status, 'epic');
          if (targetStatus !== epicStatus) continue;
        }

        // Tag filter (AND logic)
        if (options.tag?.length > 0) {
          const epicTags = data.tags || [];
          const allTagsMatch = options.tag.every((t: string) => epicTags.includes(t));
          if (!allTagsMatch) continue;
        }

        // Count tasks (artefacts.ts contract)
        const taskCount = getTasksForEpic(epicEntry.id).length;

        const prdName = path.basename(epicEntry.prdDir);
        const epicResult: Epic & { file?: string; prd: string; tasks: number } = {
          id: data.id,
          title: data.title || '',
          status: data.status || 'Unknown',
          parent: data.parent || '',
          prd: prdName,
          tasks: taskCount
        };
        if (options.path) epicResult.file = epicEntry.file;
        epics.push(epicResult);
      }

      // Sort by ID
      epics.sort((a, b) => {
        const numA = parseInt(a.id?.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.id?.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

      // Apply limit
      const limited = options.limit ? epics.slice(0, options.limit) : epics;

      if (options.json) {
        jsonOut(limited);
      } else {
        if (limited.length === 0) {
          console.log('No epics found.');
        } else {
          limited.forEach(e => {
            const sym = statusSymbol(e.status);
            const prdId = e.prd.match(/^PRD-\d+/)?.[0] || e.prd;
            console.log(`${sym} ${e.id}: ${e.title} [${e.status}] (${e.tasks} tasks) ${prdId}`);
          });
          if (options.limit && epics.length > options.limit) {
            console.log(`\n... and ${epics.length - options.limit} more`);
          }
        }
      }
    });

  // epic:show
  epic.command('show <id>')
    .description('Show epic details (tasks count by status)')
    .option('--role <role>', 'Role context: agent blocked, skill/coordinator allowed')
    .option('--raw', 'Dump raw markdown')
    .option('--comments', 'Include template comments (stripped by default)')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((id, options) => {
      // Role enforcement: agents don't access epics directly
      if (options.role === 'agent') {
        console.error('ERROR: epic:show cannot be called with --role agent');
        console.error('Agents access task-level only. Use task:show-memory for context.');
        process.exit(1);
      }

      const result = findEpicFile(id);
      if (!result) {
        console.error(`Epic not found: ${id}`);
        process.exit(1);
      }

      const { file: epicFile, prdDir } = result;

      // Raw mode: dump file content
      if (options.raw) {
        if (options.path) console.log(`# File: ${epicFile}\n`);
        const content = fs.readFileSync(epicFile, 'utf8');
        console.log(options.comments ? content : stripComments(content));
        return;
      }

      const file = loadFile(epicFile);
      const epicIdNorm = normalizeId(file.data.id);

      // Get task summary (artefacts.ts contract)
      const tasks = getTasksForEpic(epicIdNorm).map(t => ({
        id: t.data?.id,
        status: t.data?.status
      }));

      const tasksByStatus: Record<string, number> = {};
      tasks.forEach(t => {
        const status = t.status || 'Unknown';
        tasksByStatus[status] = (tasksByStatus[status] || 0) + 1;
      });

      const output: any = {
        ...file.data,
        prd: path.basename(prdDir),
        taskCount: tasks.length,
        tasksByStatus
      };
      if (options.path) output.file = epicFile;

      if (options.json) {
        jsonOut(output);
      } else {
        console.log(`# ${file.data.id}: ${file.data.title}\n`);
        console.log(`Status: ${file.data.status}`);
        console.log(`PRD: ${path.basename(prdDir)}`);
        console.log(`\nTasks: ${tasks.length}`);
        Object.entries(tasksByStatus).forEach(([status, count]) => {
          console.log(`  ${statusSymbol(status)} ${status}: ${count}`);
        });
        if (options.path) console.log(`\nFile: ${epicFile}`);
      }
    });

  // epic:create
  withModifies(epic.command('create <prd> <title>'), ['epic'])
    .description('Create epic in PRD (e.g., PRD-001 "Title")')
    .option('--story <id>', 'Link to story (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--tag <tag>', 'Add tag (repeatable, slugified to kebab-case)', (v, arr) => arr.concat(v), [])
    .option('--target-version <comp:ver>', 'Target version (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--path', 'Show file path')
    .option('--json', 'JSON output')
    .action((prd: string, title: string, options: EpicCreateOptions) => {
      const prdDir = findPrdDirs().find(d => matchesPrdDir(d, prd));
      if (!prdDir) {
        console.error(`PRD not found: ${prd}`);
        process.exit(1);
      }

      const epicsDir = path.join(prdDir, 'epics');
      if (!fs.existsSync(epicsDir)) {
        fs.mkdirSync(epicsDir, { recursive: true });
      }

      const num = nextId('epic');
      const id = formatId('E', num);
      const filename = `${id}-${toKebab(title)}.md`;
      const epicPath = path.join(epicsDir, filename);

      const data: Epic = {
        id,
        title,
        status: 'Not Started',
        parent: path.basename(prdDir).split('-').slice(0,2).join('-'),
        blocked_by: [],
        stories: [],
        tags: [],
        milestone: '',
        target_versions: {}
      };

      // Add stories if specified
      if (options.story?.length > 0) {
        data.stories = options.story.map((s: string) => normalizeId(s));
      }

      // Add tags if specified (slugified to kebab-case)
      if (options.tag?.length > 0) {
        data.tags = options.tag.map((t: string) => toKebab(t));
      }

      // Add target versions if specified
      if (options.targetVersion?.length > 0) {
        options.targetVersion.forEach((tv: string) => {
          const [comp, ver] = tv.split(':');
          if (comp && ver) data.target_versions[comp] = ver;
        });
      }

      // Load template or use minimal body
      let body = loadTemplate('epic');
      if (body) {
        body = body.replace(/^---[\s\S]*?---\s*/, '');
        body = body.replace(/# E0000: Epic Title/g, `# ${id}: ${title}`);
      } else {
        body = `\n# ${id}: ${title}\n\n## Description\n\n[Add description]\n\n## Tasks\n\n- [ ] [Task 1]\n\n## Acceptance Criteria\n\n- [ ] [Criterion 1]\n`;
      }

      saveFile(epicPath, data, body);

      // Create memory file
      const memDir = getMemoryDir();
      if (!fs.existsSync(memDir)) {
        fs.mkdirSync(memDir, { recursive: true });
      }
      const memoryFile = path.join(memDir, `${id}.md`);
      const memoryContent = `---
epic: ${id}
created: '${new Date().toISOString()}'
updated: '${new Date().toISOString()}'
---

# Memory: ${id}

## Agent Context

## Escalation

## Story
`;
      fs.writeFileSync(memoryFile, memoryContent);

      if (options.json) {
        const output: Record<string, unknown> = { id, title, parent: data.parent };
        if (options.path) {
          output.file = epicPath;
          output.memory = memoryFile;
        }
        jsonOut(output);
      } else {
        console.log(`Created: ${id} - ${title}`);
        if (options.path) console.log(`File: ${epicPath}`);
        console.log(`\n${'─'.repeat(60)}\n`);
        console.log(fs.readFileSync(epicPath, 'utf8'));
      }
    });

  // epic:update
  withModifies(epic.command('update <id>'), ['epic'])
    .description('Update epic (status, versions, stories, blockers)')
    .option('-s, --status <status>', `Set status (${statusHelp})`)
    .option('-a, --assignee <name>', 'Set assignee')
    .option('-t, --title <title>', 'Set title')
    .option('--add-blocker <id>', 'Add blocker (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--remove-blocker <id>', 'Remove blocker (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--clear-blockers', 'Clear all blockers')
    .option('--story <id>', 'Link to story (repeatable, replaces existing)', (v, arr) => arr.concat(v), [])
    .option('--add-story <id>', 'Add story link (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--remove-story <id>', 'Remove story link (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--target-version <comp:ver>', 'Set target version (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--remove-target-version <comp>', 'Remove target version', (v, arr) => arr.concat(v), [])
    .option('--set <key=value>', 'Set any frontmatter field (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--json', 'JSON output')
    .action((id: string, options: EpicUpdateOptions) => {
      const result = findEpicFile(id);
      if (!result) {
        console.error(`Epic not found: ${id}`);
        process.exit(1);
      }

      const file = loadFile(result.file);

      const opts = {
        status: options.status,
        title: options.title,
        assignee: options.assignee,
        addBlocker: options.addBlocker?.length ? options.addBlocker : null,
        removeBlocker: options.removeBlocker?.length ? options.removeBlocker : null,
        clearBlockers: options.clearBlockers || false,
        story: options.story?.length ? options.story : null,
        addStory: options.addStory?.length ? options.addStory : null,
        removeStory: options.removeStory?.length ? options.removeStory : null,
        targetVersion: options.targetVersion?.length ? options.targetVersion : null,
        removeTargetVersion: options.removeTargetVersion?.length ? options.removeTargetVersion : null,
        set: options.set?.length ? options.set : null
      };

      const { updated, data } = parseUpdateOptions(opts, file.data, 'epic') as { updated: boolean; data: Epic };

      if (updated) {
        saveFile(result.file, data, file.body);
        if (options.json) {
          jsonOut(data);
        } else {
          console.log(`Updated: ${data.id}`);
        }
      } else {
        console.log('No changes made.');
      }
    });

  // epic:show-memory - DEPRECATED: use memory:show instead
  // Removed - use: rudder memory:show ENNN [--full]

  // epic:dump-logs
  epic.command('dump-logs <id>')
    .description('Show epic log content')
    .action((id) => {
      const epicId = normalizeId(id);
      const content = getEpicMemory(epicId).getLogContent();

      if (!content) {
        console.log(`No logs for ${epicId}`);
        return;
      }

      console.log(content);
    });

  // epic:clean-logs
  withModifies(epic.command('clean-logs <id>'), ['epic'])
    .description('Delete epic log file')
    .action((id) => {
      const epicId = normalizeId(id);
      const deleted = getEpicMemory(epicId).deleteLog();

      if (!deleted) {
        console.log(`No logs for ${epicId}`);
        return;
      }

      console.log(`Deleted logs for ${epicId}`);
    });

  // epic:merge-logs
  withModifies(epic.command('merge-logs <id>'), ['epic'])
    .description('Merge task logs into epic log and flush (TNNN.log → ENNN.log)')
    .option('--keep', 'Keep task logs after merge (don\'t delete)')
    .action((id: string, options: { keep?: boolean }) => {
      const epicId = normalizeId(id);
      const result = getEpicMemory(epicId).mergeTaskLogs({ keep: options.keep }) as { flushedCount: number; deletedEmpty: number; totalEntries: number };

      if (result.flushedCount === 0 && result.deletedEmpty === 0) {
        console.log(`No task logs to flush for ${epicId}`);
      } else {
        if (result.flushedCount > 0) {
          console.log(`Flushed ${result.totalEntries} entries from ${result.flushedCount} tasks to ${epicId}.log`);
        }
        if (result.deletedEmpty > 0) {
          console.log(`Deleted ${result.deletedEmpty} empty log files`);
        }
      }
    });

  // epic:ensure-memory
  withModifies(epic.command('ensure-memory <id>'), ['epic'])
    .description('Create memory file from template if missing')
    .option('--path', 'Show file path (discouraged)')
    .action((id, options) => {
      const epicId = normalizeId(id);
      const memoryFile = path.join(getMemoryDir(), `${epicId}.md`);

      if (fs.existsSync(memoryFile)) {
        console.log(`Memory already exists: ${epicId}`);
        return;
      }

      // Load template
      let template = loadTemplate('memory');
      if (!template) {
        // Fallback template
        template = `---
epic: ${epicId}
created: '${new Date().toISOString()}'
updated: '${new Date().toISOString()}'
---

# Memory: ${epicId}

## Agent Context

## Escalation

## Story
`;
      } else {
        // Replace placeholders in template
        template = template.replace(/E0000/g, epicId);
        template = template.replace(/created: ''/g, `created: '${new Date().toISOString()}'`);
        template = template.replace(/updated: ''/g, `updated: '${new Date().toISOString()}'`);
      }

      // Ensure directory exists
      const memDir = getMemoryDir();
      if (!fs.existsSync(memDir)) {
        fs.mkdirSync(memDir, { recursive: true });
      }

      fs.writeFileSync(memoryFile, template);
      console.log(options.path ? `Created: ${memoryFile}` : `Created memory for ${epicId}`);
    });

  // epic:memory
  withModifies(epic.command('memory <id> <message>'), ['epic'])
    .description('Add entry to epic memory')
    .option('--tip', 'Add as tip (what works well)')
    .option('--cmd', 'Add as command (useful commands)')
    .option('--issue', 'Add as issue (known problems)')
    .option('--solution', 'Add as solution (how to fix)')
    .action((id, message, options) => {
      const epicId = normalizeId(id);

      // Determine section
      let section = 'Tips'; // default
      if (options.cmd) section = 'Commands';
      else if (options.issue) section = 'Issues';
      else if (options.solution) section = 'Solutions';

      // Ensure memory directory exists
      const memDir = getMemoryDir();
      if (!fs.existsSync(memDir)) {
        fs.mkdirSync(memDir, { recursive: true });
      }

      const memoryFile = path.join(memDir, `${epicId}.md`);
      let content = '';

      if (fs.existsSync(memoryFile)) {
        content = fs.readFileSync(memoryFile, 'utf8');
      } else {
        content = `# Memory: ${epicId}\n\n## Tips\n\n## Commands\n\n## Issues\n\n## Solutions\n`;
      }

      // Find section and add entry
      const header = `## ${section}`;
      const entry = `- ${message}`;

      const headerIndex = content.indexOf(header);
      if (headerIndex !== -1) {
        const insertPos = content.indexOf('\n', headerIndex) + 1;
        content = content.slice(0, insertPos) + entry + '\n' + content.slice(insertPos);
      }

      fs.writeFileSync(memoryFile, content);
      console.log(`Added to ${epicId} [${section}]: ${message}`);
    });

  // epic:patch - Apply SEARCH/REPLACE blocks to epic
  withModifies(epic.command('patch <id>'), ['epic'])
    .description('Apply SEARCH/REPLACE blocks to epic (stdin or file)')
    .option('-f, --file <path>', 'Read patch from file instead of stdin')
    .option('--dry-run', 'Show what would be changed without applying')
    .option('--json', 'JSON output')
    .action(async (id: string, options: { file?: string; dryRun?: boolean; json?: boolean }) => {
      const normalizedId = normalizeId(id);
      const epicPath = findEpicFile(normalizedId);

      if (!epicPath) {
        console.error(`Epic not found: ${id}`);
        process.exit(1);
      }

      let patchContent: string;
      if (options.file) {
        if (!fs.existsSync(options.file)) {
          console.error(`Patch file not found: ${options.file}`);
          process.exit(1);
        }
        patchContent = fs.readFileSync(options.file, 'utf8');
      } else {
        patchContent = await new Promise<string>((resolve) => {
          let data = '';
          if (process.stdin.isTTY) { resolve(''); return; }
          process.stdin.setEncoding('utf8');
          process.stdin.on('readable', () => {
            let chunk: string | null; while ((chunk = process.stdin.read() as string | null) !== null) data += chunk;
          });
          process.stdin.on('end', () => resolve(data));
        });
      }

      if (!patchContent.trim()) {
        console.error('No patch content provided');
        process.exit(1);
      }

      const ops = parseSearchReplace(patchContent);
      if (ops.length === 0) {
        console.error('No valid SEARCH/REPLACE blocks found');
        process.exit(1);
      }

      if (options.dryRun) {
        if (options.json) {
          jsonOut({ id: normalizedId, ops, dry_run: true });
        } else {
          console.log(`Would apply ${ops.length} patch(es) to ${normalizedId}`);
        }
        return;
      }

      const result = editArtifact(epicPath.file, ops);

      if (options.json) {
        jsonOut({ id: normalizedId, ...result });
      } else if (result.success) {
        console.log(`✓ Applied ${result.applied} patch(es) to ${normalizedId}`);
      } else {
        console.error(`✗ Applied ${result.applied}/${ops.length}, errors:`);
        result.errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }
    });

  // epic:edit - Edit epic sections
  withModifies(epic.command('edit <id>'), ['epic'])
    .description('Edit epic section(s)')
    .option('-s, --section <name>', 'Section to edit (omit for multi-section stdin)')
    .option('-c, --content <text>', 'New content (or use stdin)')
    .option('-a, --append', 'Append to section instead of replace')
    .option('-p, --prepend', 'Prepend to section instead of replace')
    .option('--json', 'JSON output')
    .addHelpText('after', `
Multi-section format: use ## headers with optional [op]
Operations: [replace], [append], [prepend], [delete], [sed], [check], [uncheck], [toggle], [patch]
See: bin/rudder artifact edit --help for full documentation
`)
    .action(async (id: string, options: EpicEditOptions) => {
      const result = findEpicFile(id);
      if (!result) {
        console.error(`Epic not found: ${id}`);
        process.exit(1);
      }

      const epicPath = result.file;

      let content = options.content;
      if (!content) {
        content = await new Promise<string>((resolve) => {
          let data = '';
          if (process.stdin.isTTY) { resolve(''); return; }
          process.stdin.setEncoding('utf8');
          process.stdin.on('readable', () => {
            let chunk: string | null; while ((chunk = process.stdin.read() as string | null) !== null) data += chunk;
          });
          process.stdin.on('end', () => resolve(data));
        });
        content = content.trim();
      }

      if (!content) {
        console.error('Content required via --content or stdin');
        process.exit(1);
      }

      let opType = 'replace';
      if (options.append) opType = 'append';
      if (options.prepend) opType = 'prepend';

      const ops = options.section
        ? [{ op: opType, section: options.section, content }]
        : parseMultiSectionContent(content, opType);

      if (ops.length === 0) {
        console.error('No sections found. Use --section or format stdin with ## headers');
        process.exit(1);
      }

      const originalOps = ops.map((o: { op: string; section: string }) => ({ op: o.op, section: o.section }));
      const { expandedOps, errors: processErrors } = processMultiSectionOps(epicPath, ops) as { expandedOps: unknown[]; errors: string[] };
      if (processErrors.length > 0) {
        processErrors.forEach(e => console.error(e));
        process.exit(1);
      }

      const editResult = editArtifact(epicPath, expandedOps);

      if (options.json) {
        jsonOut({ id: normalizeId(id), ...editResult });
      } else if (editResult.success) {
        if (originalOps.length === 1) {
          console.log(`✓ ${originalOps[0].op} on ${originalOps[0].section} in ${normalizeId(id)}`);
        } else {
          const byOp: Record<string, number> = {};
          originalOps.forEach((o: { op: string }) => { byOp[o.op] = (byOp[o.op] || 0) + 1; });
          const summary = Object.entries(byOp).map(([op, n]) => `${op}:${n}`).join(', ');
          console.log(`✓ ${originalOps.length} sections in ${normalizeId(id)} (${summary})`);
        }
      } else {
        console.error(`✗ Failed: ${editResult.errors.join(', ')}`);
        process.exit(1);
      }
    });
}
