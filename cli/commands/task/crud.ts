/**
 * Task CRUD commands (create, update)
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, saveFile, toKebab, loadTemplate, jsonOut, formatId } from '../../managers/core-manager.js';
import { normalizeId, matchesPrdDir } from '../../lib/normalize.js';
import { STATUS, normalizeStatus } from '../../lib/lexicon.js';
import { nextId } from '../../managers/state-manager.js';
import { parseUpdateOptions } from '../../lib/update.js';
import { withModifies } from '../../lib/help.js';
import { findTaskFile, findEpicParent } from './helpers.js';
import { Task } from '../../lib/types/entities.js';
import type { Command } from 'commander';
import type { TaskCreateOptions, TaskUpdateOptions } from '../../lib/types/task-options.js';

/**
 * Register task:create and task:update commands
 */
export function registerCrudCommands(task: Command): void {
  const statusHelp = STATUS.task.join(', ');

  // task:create
  withModifies(task.command('create <parent> <title>'), ['task'])
    .description('Create task under epic (e.g., E035 or PRD-001/E035 "Title")')
    .option('--story <id>', 'Link to story (repeatable)', (v: string, arr: string[]) => arr.concat(v), [] as string[])
    .option('--tag <tag>', 'Add tag (repeatable, slugified to kebab-case)', (v: string, arr: string[]) => arr.concat(v), [] as string[])
    .option('--target-version <comp:ver>', 'Target version (repeatable)', (v: string, arr: string[]) => arr.concat(v), [] as string[])
    .option('--path', 'Show file path')
    .option('--json', 'JSON output')
    .action((parent: string, title: string, options: TaskCreateOptions) => {
      let prdDir: string | undefined;
      let epicPart: string | null;
      let prdId: string;

      // Check if parent is just an epic ID (e.g., E0076)
      const epicOnlyMatch = parent.match(/^E\d+$/i);
      if (epicOnlyMatch) {
        // Find PRD from epic
        const epicInfo = findEpicParent(parent);
        if (!epicInfo) {
          console.error(`Epic not found: ${parent}`);
          process.exit(1);
        }
        prdDir = epicInfo.prdDir;
        epicPart = normalizeId(parent);
        prdId = epicInfo.prdId;
      } else {
        // Parse parent: PRD-001/E001 or PRD-001
        const parentParts = parent.split('/');
        const prdPart = parentParts[0];
        epicPart = parentParts[1] ? normalizeId(parentParts[1]) : null;

        // Tasks MUST belong to an epic
        if (!epicPart) {
          console.error(`Tasks must belong to an epic. Use: task:create PRD-XXX/EXXX "title" or task:create EXXX "title"`);
          process.exit(1);
        }

        // Find PRD directory
        prdDir = findPrdDirs().find(d => matchesPrdDir(d, prdPart));
        if (!prdDir) {
          console.error(`PRD not found: ${prdPart}`);
          process.exit(1);
        }
        prdId = path.basename(prdDir).match(/^PRD-\d+/)?.[0] || path.basename(prdDir).split('-').slice(0, 2).join('-');
      }

      const tasksDir = path.join(prdDir, 'tasks');
      if (!fs.existsSync(tasksDir)) {
        fs.mkdirSync(tasksDir, { recursive: true });
      }

      const num = nextId('task');
      const id = formatId('T', num);
      const filename = `${id}-${toKebab(title)}.md`;
      const taskPath = path.join(tasksDir, filename);

      const data: Task = {
        id,
        title,
        status: 'Not Started',
        parent: epicPart ? `${prdId} / ${epicPart}` : prdId,
        assignee: '',
        blocked_by: [],
        stories: [],
        tags: [],
        effort: '1h',
        priority: 'normal',
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
        data.target_versions = {};
        options.targetVersion.forEach(tv => {
          const [comp, ver] = tv.split(':');
          if (comp && ver) data.target_versions[comp] = ver;
        });
      }

      // Load template or use minimal body
      let body = loadTemplate('task');
      if (body) {
        body = body.replace(/^---[\s\S]*?---\s*/, ''); // Remove template frontmatter
        body = body.replace(/# T00000: Task Title/g, `# ${id}: ${title}`);
      } else {
        body = `\n# ${id}: ${title}\n\n## Description\n\n[Add description]\n\n## Deliverables\n\n- [ ] [Deliverable 1]\n\n## Log\n`;
      }

      saveFile(taskPath, data, body);

      if (options.json) {
        const output: { id: string; title: string; parent: string; file?: string } = { id, title, parent: data.parent };
        if (options.path) output.file = taskPath;
        jsonOut(output);
      } else {
        console.log(`Created: ${id} - ${title}`);
        if (options.path) console.log(`File: ${taskPath}`);
        console.log(`\n${'─'.repeat(60)}\n`);
        console.log(fs.readFileSync(taskPath, 'utf8'));
        console.log(`${'─'.repeat(60)}`);
        console.log(`\nEdit with CLI:`);
        console.log(`  rudder task:edit ${id} <<EOF`);
        console.log(`  ## Description`);
        console.log(`  Your task description here...`);
        console.log(`  EOF`);
        console.log(`\nMore: rudder task:edit --help`);
      }
    });

  // task:update
  withModifies(task.command('update <id>'), ['task'])
    .description('Update task (status, assignee, blockers, stories, versions)')
    .option('-s, --status <status>', `Set status (${statusHelp})`)
    .option('-a, --assignee <name>', 'Set assignee')
    .option('-t, --title <title>', 'Set title')
    .option('-e, --effort <duration>', 'Set effort/duration (e.g., 4h, 8h or legacy S|M|L|XL)')
    .option('-p, --priority <level>', 'Set priority (low|normal|high|critical)')
    .option('--add-blocker <id>', 'Add blocker (repeatable)', (v: string, arr: string[]) => arr.concat(v), [] as string[])
    .option('--blocked-by <ids>', 'Set blockers (comma-separated, e.g., T001,T002)')
    .option('--remove-blocker <id>', 'Remove blocker (repeatable)', (v: string, arr: string[]) => arr.concat(v), [] as string[])
    .option('--clear-blockers', 'Clear all blockers')
    .option('--story <id>', 'Link to story (repeatable, replaces existing)', (v: string, arr: string[]) => arr.concat(v), [] as string[])
    .option('--add-story <id>', 'Add story link (repeatable)', (v: string, arr: string[]) => arr.concat(v), [] as string[])
    .option('--remove-story <id>', 'Remove story link (repeatable)', (v: string, arr: string[]) => arr.concat(v), [] as string[])
    .option('--target-version <comp:ver>', 'Set target version (repeatable)', (v: string, arr: string[]) => arr.concat(v), [] as string[])
    .option('--remove-target-version <comp>', 'Remove target version', (v: string, arr: string[]) => arr.concat(v), [] as string[])
    .option('--set <key=value>', 'Set any frontmatter field (repeatable)', (v: string, arr: string[]) => arr.concat(v), [] as string[])
    .option('--json', 'JSON output')
    .action((id: string, options: TaskUpdateOptions) => {
      const taskFile = findTaskFile(id);
      if (!taskFile) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      const file = loadFile(taskFile);
      const fileData = file?.data as Record<string, unknown>;

      // Convert Commander options format
      // Merge --blocked-by (comma-separated) with --add-blocker (repeatable)
      let blockers: string[] = options.addBlocker || [];
      if (options.blockedBy) {
        const parsed = options.blockedBy.split(',').map((s: string) => s.trim()).filter(Boolean);
        blockers = [...blockers, ...parsed];
      }

      const opts = {
        status: options.status,
        title: options.title,
        assignee: options.assignee,
        effort: options.effort,
        priority: options.priority,
        addBlocker: blockers.length ? blockers : null,
        removeBlocker: options.removeBlocker?.length ? options.removeBlocker : null,
        clearBlockers: options.clearBlockers,
        story: options.story?.length ? options.story : null,
        addStory: options.addStory?.length ? options.addStory : null,
        removeStory: options.removeStory?.length ? options.removeStory : null,
        targetVersion: options.targetVersion?.length ? options.targetVersion : null,
        removeTargetVersion: options.removeTargetVersion?.length ? options.removeTargetVersion : null,
        set: options.set?.length ? options.set : null
      };

      const { updated, data } = parseUpdateOptions(opts, fileData, 'task') as { updated: boolean; data: Record<string, unknown> };

      if (updated) {
        saveFile(taskFile, data, file.body);
        if (options.json) {
          jsonOut(data);
        } else {
          console.log(`Updated: ${data.id}`);
        }
      } else {
        console.log('No changes made.');
      }
    });
}
