/**
 * Epic commands for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, findFiles, loadFile, saveFile, toKebab, loadTemplate, jsonOut, getMemoryDir } from '../lib/core.js';
import { normalizeId, matchesId, matchesPrdDir } from '../lib/normalize.js';
import { STATUS, normalizeStatus, statusSymbol } from '../lib/lexicon.js';
import { nextId } from '../lib/state.js';
import { parseUpdateOptions } from '../lib/update.js';
import { addDynamicHelp } from '../lib/help.js';
import { formatId } from '../lib/config.js';
import { parseSearchReplace, editArtifact } from '../lib/artifact.js';

/**
 * Find an epic file by ID
 */
function findEpicFile(epicId) {
  const normalizedId = normalizeId(epicId);
  for (const prdDir of findPrdDirs()) {
    const epicsDir = path.join(prdDir, 'epics');
    const files = findFiles(epicsDir, /^E\d+.*\.md$/);
    for (const f of files) {
      if (matchesId(f, epicId)) return { file: f, prdDir };
    }
  }
  return null;
}

/**
 * Register epic commands
 */
export function registerEpicCommands(program) {
  const epic = program.command('epic').description('Epic operations (groups of tasks)');

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
    .option('--json', 'JSON output')
    .action((prdArg, options) => {
      const prd = prdArg || options.prd;
      const epics = [];

      for (const prdDir of findPrdDirs()) {
        if (prd && !matchesPrdDir(prdDir, prd)) continue;

        const prdName = path.basename(prdDir);
        const epicsDir = path.join(prdDir, 'epics');

        findFiles(epicsDir, /^E\d+.*\.md$/).forEach(f => {
          const file = loadFile(f);
          if (!file?.data) return;

          // Status filter
          if (options.status) {
            const targetStatus = normalizeStatus(options.status, 'epic');
            const epicStatus = normalizeStatus(file.data.status, 'epic');
            if (targetStatus !== epicStatus) return;
          }

          // Tag filter (AND logic)
          if (options.tag?.length > 0) {
            const epicTags = file.data.tags || [];
            const allTagsMatch = options.tag.every(t => epicTags.includes(t));
            if (!allTagsMatch) return;
          }

          // Count tasks
          const tasksDir = path.join(prdDir, 'tasks');
          const epicIdNorm = normalizeId(file.data.id);
          const taskCount = findFiles(tasksDir, /^T\d+.*\.md$/)
            .filter(t => {
              const tf = loadFile(t);
              return tf?.data?.parent?.includes(epicIdNorm);
            }).length;

          epics.push({
            id: file.data.id,
            title: file.data.title || '',
            status: file.data.status || 'Unknown',
            prd: prdName,
            tasks: taskCount,
            file: f
          });
        });
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
    .option('--raw', 'Dump raw markdown file')
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

      // Raw mode: dump file content with path header
      if (options.raw) {
        console.log(`# File: ${epicFile}\n`);
        console.log(fs.readFileSync(epicFile, 'utf8'));
        return;
      }

      const file = loadFile(epicFile);
      const epicIdNorm = normalizeId(file.data.id);

      // Get task summary
      const tasksDir = path.join(prdDir, 'tasks');
      const tasks = findFiles(tasksDir, /^T\d+.*\.md$/)
        .map(t => {
          const tf = loadFile(t);
          return { id: tf?.data?.id, status: tf?.data?.status, parent: tf?.data?.parent };
        })
        .filter(t => t.parent?.includes(epicIdNorm));

      const tasksByStatus = {};
      tasks.forEach(t => {
        const status = t.status || 'Unknown';
        tasksByStatus[status] = (tasksByStatus[status] || 0) + 1;
      });

      const output = {
        ...file.data,
        file: epicFile,
        prd: path.basename(prdDir),
        taskCount: tasks.length,
        tasksByStatus
      };

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
        console.log(`\nFile: ${epicFile}`);
      }
    });

  // epic:create
  epic.command('create <prd> <title>')
    .description('Create epic in PRD (e.g., PRD-001 "Title")')
    .option('--story <id>', 'Link to story (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--tag <tag>', 'Add tag (repeatable, slugified to kebab-case)', (v, arr) => arr.concat(v), [])
    .option('--target-version <comp:ver>', 'Target version (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--json', 'JSON output')
    .action((prd, title, options) => {
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

      const data = {
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
        data.stories = options.story.map(s => normalizeId(s));
      }

      // Add tags if specified (slugified to kebab-case)
      if (options.tag?.length > 0) {
        data.tags = options.tag.map(t => toKebab(t));
      }

      // Add target versions if specified
      if (options.targetVersion?.length > 0) {
        options.targetVersion.forEach(tv => {
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
        jsonOut({ id, title, parent: data.parent, file: epicPath, memory: memoryFile });
      } else {
        console.log(`Created: ${id} - ${title}`);
        console.log(`\nEdit commands:`);
        console.log(`  bin/rudder artifact:show ${id} --list`);
        console.log(`  bin/rudder artifact:edit ${id} --section "Description" <<'EOF'`);
        console.log(`Your epic description here...`);
        console.log(`EOF`);
      }
    });

  // epic:update
  epic.command('update <id>')
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
    .action((id, options) => {
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

      const { updated, data } = parseUpdateOptions(opts, file.data, 'epic');

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
      const epicLogFile = path.join(getMemoryDir(), `${epicId}.log`);

      if (!fs.existsSync(epicLogFile)) {
        console.log(`No logs for ${epicId}`);
        return;
      }

      const content = fs.readFileSync(epicLogFile, 'utf8');
      console.log(content.trim());
    });

  // epic:clean-logs
  epic.command('clean-logs <id>')
    .description('Delete epic log file')
    .action((id) => {
      const epicId = normalizeId(id);
      const epicLogFile = path.join(getMemoryDir(), `${epicId}.log`);

      if (!fs.existsSync(epicLogFile)) {
        console.log(`No logs for ${epicId}`);
        return;
      }

      fs.unlinkSync(epicLogFile);
      console.log(`Deleted: ${epicLogFile}`);
    });

  // epic:merge-logs
  epic.command('merge-logs <id>')
    .description('Merge task logs into epic log and flush (TNNN.log → ENNN.log)')
    .option('--keep', 'Keep task logs after merge (don\'t delete)')
    .action((id, options) => {
      const epicId = normalizeId(id);

      // Find all tasks for this epic
      const tasksForEpic = [];
      for (const prdDir of findPrdDirs()) {
        const tasksDir = path.join(prdDir, 'tasks');
        findFiles(tasksDir, /^T\d+.*\.md$/).forEach(f => {
          const file = loadFile(f);
          if (!file?.data) return;
          const parent = (file.data.parent || '').toUpperCase();
          if (parent.includes(epicId.toUpperCase())) {
            tasksForEpic.push({
              id: normalizeId(file.data.id),
              title: file.data.title
            });
          }
        });
      }

      if (tasksForEpic.length === 0) {
        console.log(`No tasks found for ${epicId}`);
        return;
      }

      // Ensure memory directory exists
      const memDir = getMemoryDir();
      if (!fs.existsSync(memDir)) {
        fs.mkdirSync(memDir, { recursive: true });
      }

      const epicLogFile = path.join(memDir, `${epicId}.log`);
      let flushedCount = 0;
      let totalEntries = 0;

      // Process each task log
      let deletedEmpty = 0;
      for (const task of tasksForEpic) {
        const taskLogFile = path.join(memDir, `${task.id}.log`);
        if (!fs.existsSync(taskLogFile)) continue;

        const content = fs.readFileSync(taskLogFile, 'utf8').trim();

        // Delete empty logs
        if (!content) {
          if (!options.keep) {
            fs.unlinkSync(taskLogFile);
            deletedEmpty++;
          }
          continue;
        }

        const entries = content.split('\n').length;
        totalEntries += entries;

        // Append to epic log with task header
        const header = `\n### ${task.id}: ${task.title}\n`;
        fs.appendFileSync(epicLogFile, header + content + '\n');
        flushedCount++;

        // Clear task log unless --keep
        if (!options.keep) {
          fs.unlinkSync(taskLogFile);
        }
      }

      if (flushedCount === 0 && deletedEmpty === 0) {
        console.log(`No task logs to flush for ${epicId}`);
      } else {
        if (flushedCount > 0) {
          console.log(`Flushed ${totalEntries} entries from ${flushedCount} tasks to ${epicId}.log`);
        }
        if (deletedEmpty > 0) {
          console.log(`Deleted ${deletedEmpty} empty log files`);
        }
      }
    });

  // epic:ensure-memory
  epic.command('ensure-memory <id>')
    .description('Create memory file from template if missing')
    .action((id) => {
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
      console.log(`Created: ${memoryFile}`);
    });

  // epic:memory
  epic.command('memory <id> <message>')
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
  epic.command('patch <id>')
    .description('Apply SEARCH/REPLACE blocks to epic (stdin or file)')
    .option('-f, --file <path>', 'Read patch from file instead of stdin')
    .option('--dry-run', 'Show what would be changed without applying')
    .option('--json', 'JSON output')
    .action(async (id, options) => {
      const normalizedId = normalizeId(id);
      const epicPath = findEpicFile(normalizedId);

      if (!epicPath) {
        console.error(`Epic not found: ${id}`);
        process.exit(1);
      }

      let patchContent;
      if (options.file) {
        if (!fs.existsSync(options.file)) {
          console.error(`Patch file not found: ${options.file}`);
          process.exit(1);
        }
        patchContent = fs.readFileSync(options.file, 'utf8');
      } else {
        patchContent = await new Promise((resolve) => {
          let data = '';
          if (process.stdin.isTTY) { resolve(''); return; }
          process.stdin.setEncoding('utf8');
          process.stdin.on('readable', () => {
            let chunk; while ((chunk = process.stdin.read()) !== null) data += chunk;
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

      const result = editArtifact(epicPath, ops);

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
}
