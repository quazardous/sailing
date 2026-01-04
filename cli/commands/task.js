/**
 * Task commands for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, findFiles, loadFile, saveFile, toKebab, loadTemplate, jsonOut, getMemoryDir, stripComments } from '../lib/core.js';
import { normalizeId, matchesId, matchesPrdDir } from '../lib/normalize.js';
import { findEpicParent, findEpicFile } from '../lib/entities.js';
import { getHierarchicalMemory, ensureMemoryDir } from '../lib/memory.js';
import { STATUS, normalizeStatus, isStatusDone, isStatusNotStarted, isStatusInProgress, isStatusCancelled, statusSymbol } from '../lib/lexicon.js';
import { buildDependencyGraph, blockersResolved } from '../lib/graph.js';
import { nextId } from '../lib/state.js';
import { parseUpdateOptions, addLogEntry } from '../lib/update.js';
import { addDynamicHelp } from '../lib/help.js';
import { formatId } from '../lib/config.js';
import { parseSearchReplace, editArtifact, parseMultiSectionContent, processMultiSectionOps } from '../lib/artifact.js';

/**
 * Find a task file by ID
 */
function findTaskFile(taskId) {
  const normalizedId = normalizeId(taskId);
  for (const prdDir of findPrdDirs()) {
    const tasksDir = path.join(prdDir, 'tasks');
    const files = findFiles(tasksDir, /^T\d+.*\.md$/);
    for (const f of files) {
      if (matchesId(f, taskId)) return f;
    }
  }
  return null;
}

// findEpicParent imported from lib/entities.js

/**
 * Register task commands
 */
export function registerTaskCommands(program) {
  const task = program.command('task').description('Task operations');

  // Dynamic help generated from registered commands
  addDynamicHelp(task, { entityType: 'task' });

  const statusHelp = STATUS.task.join(', ');

  // task:list
  task.command('list [prd]')
    .description('List tasks (filter by PRD, epic, status, assignee, tag)')
    .option('-s, --status <status>', `Filter by status (${statusHelp})`)
    .option('-e, --epic <id>', 'Filter by epic (e.g., E035)')
    .option('-a, --assignee <name>', 'Filter by assignee')
    .option('-t, --tag <tag>', 'Filter by tag (repeatable, AND logic)', (v, arr) => arr.concat(v), [])
    .option('-r, --ready', 'Only show ready tasks (unblocked)')
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .option('--prd <id>', 'Filter by PRD (alias for positional arg)')
    .option('--json', 'JSON output')
    .action((prdArg, options) => {
      const prd = prdArg || options.prd;
      const tasks = [];

      for (const prdDir of findPrdDirs()) {
        if (prd && !matchesPrdDir(prdDir, prd)) continue;

        const prdName = path.basename(prdDir);
        findFiles(path.join(prdDir, 'tasks'), /^T\d+.*\.md$/).forEach(f => {
          const file = loadFile(f);
          if (!file?.data) return;

          // Status filter
          if (options.status) {
            const targetStatus = normalizeStatus(options.status, 'task');
            const taskStatus = normalizeStatus(file.data.status, 'task');
            if (targetStatus !== taskStatus) return;
          }

          // Epic filter
          if (options.epic) {
            const epicId = normalizeId(options.epic);
            const parent = (file.data.parent || '').toUpperCase();
            if (!parent.includes(epicId.toUpperCase())) return;
          }

          // Assignee filter
          if (options.assignee) {
            const assignee = (file.data.assignee || '').toLowerCase();
            if (!assignee.includes(options.assignee.toLowerCase())) return;
          }

          // Tag filter (AND logic - all specified tags must be present)
          if (options.tag?.length > 0) {
            const taskTags = file.data.tags || [];
            const allTagsMatch = options.tag.every(t => taskTags.includes(t));
            if (!allTagsMatch) return;
          }

          tasks.push({
            id: file.data.id || path.basename(f, '.md').match(/^T\d+/)?.[0],
            title: file.data.title || '',
            status: file.data.status || 'Unknown',
            assignee: file.data.assignee || 'unassigned',
            effort: file.data.effort || null,
            priority: file.data.priority || 'normal',
            blocked_by: file.data.blocked_by || [],
            prd: prdName,
            file: f
          });
        });
      }

      // Ready filter (unblocked tasks only)
      let filtered = tasks;
      if (options.ready) {
        const { tasks: graphTasks } = buildDependencyGraph();
        filtered = tasks.filter(t => {
          const graphTask = graphTasks.get(normalizeId(t.id));
          return graphTask && blockersResolved(graphTask, graphTasks);
        });
      }

      // Sort by ID
      filtered.sort((a, b) => {
        const numA = parseInt(a.id?.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.id?.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

      // Apply limit
      const limited = options.limit ? filtered.slice(0, options.limit) : filtered;

      if (options.json) {
        jsonOut(limited);
      } else {
        if (limited.length === 0) {
          console.log('No tasks found.');
        } else {
          limited.forEach(t => {
            const sym = statusSymbol(t.status);
            console.log(`${sym} ${t.id}: ${t.title} [${t.status}] @${t.assignee}`);
          });
          if (options.limit && filtered.length > options.limit) {
            console.log(`\n... and ${filtered.length - options.limit} more`);
          }
        }
      }
    });

  // task:show
  task.command('show <id>')
    .description('Show task details (blockers, dependents, ready status)')
    .option('--role <role>', 'Role context: agent (minimal), skill/coordinator (full)')
    .option('--raw', 'Dump raw markdown file')
    .option('--comments', 'Include template comments (stripped by default)')
    .option('--json', 'JSON output')
    .action((id, options) => {
      const taskFile = findTaskFile(id);
      if (!taskFile) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      // Raw mode: dump file content with path header
      if (options.raw) {
        console.log(`# File: ${taskFile}\n`);
        const content = fs.readFileSync(taskFile, 'utf8');
        console.log(options.comments ? content : stripComments(content));
        return;
      }

      const file = loadFile(taskFile);
      const isAgentRole = options.role === 'agent';

      // Agent role: minimal output (just what's needed to execute)
      if (isAgentRole) {
        const result = {
          id: file.data.id,
          title: file.data.title,
          status: file.data.status,
          parent: file.data.parent
        };

        if (options.json) {
          jsonOut(result);
        } else {
          console.log(`# ${file.data.id}: ${file.data.title}\n`);
          console.log(`Status: ${file.data.status}`);
          console.log(`Parent: ${file.data.parent || '-'}`);
          console.log(`\n→ Use task:show-memory ${file.data.id} for Agent Context`);
          console.log(`→ Use Read tool on ${taskFile} for full deliverables`);
        }
        return;
      }

      // Full output for skill/coordinator
      const { tasks, blocks } = buildDependencyGraph();
      const normalizedId = normalizeId(id);
      const task = tasks.get(normalizedId);

      const dependents = blocks.get(normalizedId) || [];
      const isReady = task ? blockersResolved(task, tasks) : false;

      const result = {
        ...file.data,
        file: taskFile,
        blockers: task?.blockedBy || [],
        dependents,
        ready: isReady && !isStatusDone(file.data.status)
      };

      if (options.json) {
        jsonOut(result);
      } else {
        console.log(`# ${file.data.id}: ${file.data.title}\n`);
        console.log(`Status: ${file.data.status}`);
        console.log(`Assignee: ${file.data.assignee || 'unassigned'}`);
        console.log(`Effort: ${file.data.effort || '-'}`);
        console.log(`Priority: ${file.data.priority || 'normal'}`);
        console.log(`Parent: ${file.data.parent || '-'}`);

        if (task?.blockedBy?.length > 0) {
          console.log(`\nBlocked by: ${task.blockedBy.join(', ')}`);
        }
        if (dependents.length > 0) {
          console.log(`Blocks: ${dependents.join(', ')}`);
        }
        if (result.ready) {
          console.log('\n✓ Ready to start');
        }
        console.log(`\nFile: ${taskFile}`);
      }
    });

  // task:create
  task.command('create <parent> <title>')
    .description('Create task under epic (e.g., E035 or PRD-001/E035 "Title")')
    .option('--story <id>', 'Link to story (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--tag <tag>', 'Add tag (repeatable, slugified to kebab-case)', (v, arr) => arr.concat(v), [])
    .option('--target-version <comp:ver>', 'Target version (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--path', 'Show file path')
    .option('--json', 'JSON output')
    .action((parent, title, options) => {
      let prdDir, epicPart, prdId;

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

      const data = {
        id,
        title,
        status: 'Not Started',
        parent: epicPart ? `${prdId} / ${epicPart}` : prdId,
        assignee: '',
        blocked_by: [],
        stories: [],
        tags: [],
        effort: 'M',
        priority: 'normal'
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
        jsonOut({ id, title, parent: data.parent, file: taskPath });
      } else {
        console.log(`Created: ${id} - ${title}`);
        if (options.path) console.log(`File: ${taskPath}`);
        console.log(`\n${'─'.repeat(60)}\n`);
        console.log(fs.readFileSync(taskPath, 'utf8'));
      }
    });

  // task:update
  task.command('update <id>')
    .description('Update task (status, assignee, blockers, stories, versions)')
    .option('-s, --status <status>', `Set status (${statusHelp})`)
    .option('-a, --assignee <name>', 'Set assignee')
    .option('-t, --title <title>', 'Set title')
    .option('-e, --effort <S|M|L|XL>', 'Set effort')
    .option('-p, --priority <level>', 'Set priority (low|normal|high|critical)')
    .option('--add-blocker <id>', 'Add blocker (repeatable)', (v, arr) => arr.concat(v), [])
    .option('--blocked-by <ids>', 'Set blockers (comma-separated, e.g., T001,T002)')
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
      const taskFile = findTaskFile(id);
      if (!taskFile) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      const file = loadFile(taskFile);

      // Convert Commander options format
      // Merge --blocked-by (comma-separated) with --add-blocker (repeatable)
      let blockers = options.addBlocker || [];
      if (options.blockedBy) {
        const parsed = options.blockedBy.split(',').map(s => s.trim()).filter(Boolean);
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

      const { updated, data } = parseUpdateOptions(opts, file.data, 'task');

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

  // task:next
  task.command('next')
    .description('Get next ready task (unassigned, unblocked)')
    .option('--prd <id>', 'Filter by PRD (e.g., PRD-006)')
    .option('--epic <id>', 'Filter by epic (e.g., E035)')
    .option('--json', 'JSON output')
    .action((options) => {
      const { tasks, blocks } = buildDependencyGraph();

      // Find ready tasks (not started, all blockers done, unassigned)
      const ready = [];
      for (const [id, task] of tasks) {
        // PRD filter
        if (options.prd) {
          const prdId = options.prd.toUpperCase().replace(/^PRD-?0*/, 'PRD-');
          if (!task.prd?.toUpperCase().includes(prdId.replace('PRD-', ''))) continue;
        }

        // Epic filter
        if (options.epic) {
          const epicId = normalizeId(options.epic);
          const parent = (task.parent || '').toUpperCase();
          if (!parent.includes(epicId.toUpperCase())) continue;
        }

        if (isStatusNotStarted(task.status) &&
            task.assignee === 'unassigned' &&
            blockersResolved(task, tasks)) {
          ready.push(task);
        }
      }

      if (ready.length === 0) {
        if (options.json) {
          jsonOut({ task: null, message: 'No ready tasks' });
        } else {
          console.log('No ready tasks available.');
        }
        return;
      }

      // Sort by priority and ID
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      ready.sort((a, b) => {
        const pa = priorityOrder[a.priority] ?? 2;
        const pb = priorityOrder[b.priority] ?? 2;
        if (pa !== pb) return pa - pb;
        const numA = parseInt(a.id.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.id.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

      const next = ready[0];
      if (options.json) {
        jsonOut(next);
      } else {
        console.log(`${next.id}: ${next.title}`);
        console.log(`PRD: ${next.prd}`);
        console.log(`File: ${next.file}`);
        if (ready.length > 1) {
          console.log(`\n${ready.length - 1} more ready task(s)`);
        }
      }
    });

  // task:start - composite command
  task.command('start <id>')
    .description('Start task → sets In Progress + assignee, checks blockers')
    .option('-a, --assignee <name>', 'Assignee name', 'agent')
    .option('--json', 'JSON output')
    .action((id, options) => {
      const taskFile = findTaskFile(id);
      if (!taskFile) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      const file = loadFile(taskFile);
      const { tasks } = buildDependencyGraph();
      const normalizedId = normalizeId(id);
      const task = tasks.get(normalizedId);

      // Check blockers
      if (task && !blockersResolved(task, tasks)) {
        const pending = task.blockedBy.filter(b => {
          const blocker = tasks.get(b);
          return blocker && !isStatusDone(blocker.status) && !isStatusCancelled(blocker.status);
        });
        console.error(`Task ${id} is blocked by: ${pending.join(', ')}`);
        process.exit(1);
      }

      // Update status and assignee
      const opts = { status: 'In Progress', assignee: options.assignee };
      const { data } = parseUpdateOptions(opts, file.data, 'task');
      saveFile(taskFile, data, file.body);

      if (options.json) {
        jsonOut(data);
      } else {
        console.log(`Started: ${data.id} - ${data.title}`);
        console.log(`Status: ${data.status}`);
        console.log(`Assignee: ${data.assignee}`);
        console.log(`\nFile: ${taskFile}`);
      }
    });

  // task:done - composite command
  task.command('done <id>')
    .description('Complete task → sets Done + adds log entry')
    .option('-m, --message <msg>', 'Log message', 'Completed')
    .option('--json', 'JSON output')
    .action((id, options) => {
      const taskFile = findTaskFile(id);
      if (!taskFile) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      const file = loadFile(taskFile);

      // Update status
      const opts = { status: 'Done' };
      const { data } = parseUpdateOptions(opts, file.data, 'task');

      // Add log entry
      const body = addLogEntry(file.body, options.message, data.assignee || 'agent');

      saveFile(taskFile, data, body);

      // Check if epic is now complete
      const epicMatch = data.parent?.match(/E(\d+)/i);
      if (epicMatch) {
        const epicId = normalizeId(`E${epicMatch[1]}`);
        const { tasks } = buildDependencyGraph();

        // Find all tasks for this epic
        const epicTasks = [...tasks.values()].filter(t =>
          t.parent?.match(/E\d+/i)?.[0]?.toUpperCase() === epicId.toUpperCase()
        );

        const allDone = epicTasks.every(t =>
          isStatusDone(t.status) || isStatusCancelled(t.status) || t.id === normalizeId(id)
        );

        if (allDone && epicTasks.length > 0) {
          console.log(`\n✓ All tasks in ${epicId} are now complete!`);
          console.log(`  Consider: rudder epic:update ${epicId} --status done`);
        }
      }

      if (options.json) {
        jsonOut(data);
      } else {
        console.log(`Completed: ${data.id} - ${data.title}`);
      }
    });

  // task:log
  const LOG_LEVELS = ['info', 'tip', 'warn', 'error', 'critical'];

  task.command('log <id> <message>')
    .description('Log message during task work (→ memory/TNNN.log)')
    .option('--info', 'Progress note (default)')
    .option('--tip', 'Useful learning, command, gotcha')
    .option('--warn', 'Issue encountered, workaround applied')
    .option('--error', 'Significant problem, needs review')
    .option('--critical', 'Cannot continue, blocks completion')
    .option('-f, --file <path>', 'Related file (repeatable)', (v, arr) => arr.concat(v), [])
    .option('-s, --snippet <code>', 'Code snippet (inline)')
    .option('-c, --cmd <command>', 'Related command')
    .action((id, message, options) => {
      // Verify task exists
      const taskFile = findTaskFile(id);
      if (!taskFile) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      // Determine level from options
      let level = 'INFO'; // default
      if (options.tip) level = 'TIP';
      else if (options.warn) level = 'WARN';
      else if (options.error) level = 'ERROR';
      else if (options.critical) level = 'CRITICAL';

      // Ensure memory directory exists
      const memDir = getMemoryDir();
      if (!fs.existsSync(memDir)) {
        fs.mkdirSync(memDir, { recursive: true });
      }

      // Build entry with optional metadata
      const taskId = normalizeId(id);
      const logFile = path.join(memDir, `${taskId}.log`);
      const timestamp = new Date().toISOString();

      let entry = `${timestamp} [${level}] ${message}`;

      // Add metadata on same line as JSON suffix if present
      const meta = {};
      if (options.file?.length) meta.files = options.file;
      if (options.snippet) meta.snippet = options.snippet;
      if (options.cmd) meta.cmd = options.cmd;

      if (Object.keys(meta).length > 0) {
        entry += ` {{${JSON.stringify(meta)}}}`;
      }
      entry += '\n';

      fs.appendFileSync(logFile, entry);

      // Output
      let output = `[${level}] ${taskId}: ${message}`;
      if (options.file?.length) output += ` (files: ${options.file.join(', ')})`;
      if (options.cmd) output += ` (cmd: ${options.cmd})`;
      console.log(output);
    });

  /**
   * task:show-memory - Agent-focused memory view
   *
   * WHY THIS EXISTS (vs memory:show):
   * - memory:show is the general-purpose command for skill/coordinator
   * - task:show-memory is specialized for agents executing tasks
   *
   * WHAT IT INCLUDES:
   * 1. Hierarchical memory (epic → PRD → project)
   *    - Tips, learnings, patterns from previous work
   * 2. Epic Technical Notes (from epic file itself)
   *    - Stack recommendations, integration approach, constraints
   * 3. Task dependency context
   *    - Resolved blockers, related tasks info
   *
   * This gives agents everything they need without reading epic/PRD files directly
   * (which would violate the "agents don't read planning docs" principle).
   */
  task.command('show-memory <id>')
    .description('Show agent-focused memory context for a task')
    .option('--json', 'JSON output')
    .action((id, options) => {
      const taskFile = findTaskFile(id);
      if (!taskFile) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      const file = loadFile(taskFile);
      const taskId = file.data.id;
      const epicParent = findEpicParent(taskFile);

      ensureMemoryDir();

      // Collect context
      const context = {
        taskId,
        epicId: epicParent?.data?.id || null,
        memory: null,
        technicalNotes: null,
        dependencies: null
      };

      // 1. Hierarchical memory (epic → PRD → project)
      if (epicParent) {
        const hierarchy = getHierarchicalMemory(epicParent.data.id);
        const memoryParts = [];

        // Extract agent-relevant sections
        const extractSections = (content, level) => {
          if (!content) return [];
          const sections = [];
          const regex = /^## ([^\n]+)\n([\s\S]*?)(?=\n## [A-Z]|$)/gm;
          let match;
          while ((match = regex.exec(content)) !== null) {
            const name = match[1].trim();
            const body = match[2].replace(/<!--[\s\S]*?-->/g, '').trim();
            if (body) sections.push({ level, name, content: body });
          }
          return sections;
        };

        if (hierarchy.project) {
          memoryParts.push(...extractSections(hierarchy.project.content, 'PROJECT'));
        }
        if (hierarchy.prd) {
          memoryParts.push(...extractSections(hierarchy.prd.content, 'PRD'));
        }
        if (hierarchy.epic) {
          memoryParts.push(...extractSections(hierarchy.epic.content, 'EPIC'));
        }

        context.memory = memoryParts;

        // 2. Epic Technical Notes (from epic file, not memory)
        const epicContent = epicParent.content || '';
        const techNotesMatch = epicContent.match(/## Technical Notes\n([\s\S]*?)(?=\n## |$)/);
        if (techNotesMatch) {
          context.technicalNotes = techNotesMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim();
        }
      }

      // 3. Task dependencies (resolved blockers)
      const { tasks } = buildDependencyGraph();
      const taskData = tasks.get(normalizeId(id));
      if (taskData?.blockedBy?.length) {
        context.dependencies = {
          blockedBy: taskData.blockedBy,
          allResolved: taskData.blockedBy.every(dep => {
            const depTask = tasks.get(dep);
            return depTask && isStatusDone(depTask.status);
          })
        };
      }

      // Output
      if (options.json) {
        jsonOut(context);
        return;
      }

      // Human-readable
      const sep = '─'.repeat(60);
      console.log(`# Agent Context: ${taskId}\n`);

      if (context.epicId) {
        console.log(`Epic: ${context.epicId}`);
      }

      // Technical Notes (most actionable for implementation)
      if (context.technicalNotes) {
        console.log(`\n${sep}`);
        console.log(`## Technical Notes (from ${context.epicId})\n`);
        console.log(context.technicalNotes);
      }

      // Memory sections
      if (context.memory?.length) {
        console.log(`\n${sep}`);
        console.log('## Memory (tips & learnings)\n');
        for (const sec of context.memory) {
          console.log(`### [${sec.level}] ${sec.name}\n`);
          console.log(sec.content);
          console.log('');
        }
      }

      // Dependencies
      if (context.dependencies) {
        console.log(`\n${sep}`);
        console.log('## Dependencies\n');
        console.log(`Blocked by: ${context.dependencies.blockedBy.join(', ')}`);
        console.log(`All resolved: ${context.dependencies.allResolved ? '✓' : '✗'}`);
      }

      if (!context.memory?.length && !context.technicalNotes && !context.dependencies) {
        console.log('(No memory or context available for this task)');
      }
    });

  // task:targets - find tasks with target_versions for a component
  task.command('targets <component>')
    .description('Find tasks with target_versions for a component')
    .option('--json', 'JSON output')
    .action((component, options) => {
      const results = [];

      for (const prdDir of findPrdDirs()) {
        const tasksDir = path.join(prdDir, 'tasks');
        const taskFiles = findFiles(tasksDir, /^T\d+.*\.md$/);

        for (const taskFile of taskFiles) {
          const file = loadFile(taskFile);
          if (file.data.target_versions && file.data.target_versions[component]) {
            results.push({
              id: file.data.id,
              title: file.data.title,
              status: file.data.status,
              target_version: file.data.target_versions[component],
              file: taskFile
            });
          }
        }

        // Also check epics
        const epicsDir = path.join(prdDir, 'epics');
        const epicFiles = findFiles(epicsDir, /^E\d+.*\.md$/);

        for (const epicFile of epicFiles) {
          const file = loadFile(epicFile);
          if (file.data.target_versions && file.data.target_versions[component]) {
            results.push({
              id: file.data.id,
              title: file.data.title,
              status: file.data.status,
              target_version: file.data.target_versions[component],
              file: epicFile,
              type: 'epic'
            });
          }
        }
      }

      if (options.json) {
        jsonOut(results);
      } else {
        if (results.length === 0) {
          console.log(`No tasks/epics target component: ${component}`);
        } else {
          console.log(`Tasks/epics targeting ${component}:\n`);
          results.forEach(r => {
            const sym = statusSymbol(r.status);
            const type = r.type === 'epic' ? ' (epic)' : '';
            console.log(`${sym} ${r.id}: ${r.title}${type}`);
            console.log(`   target: ${r.target_version} | status: ${r.status}`);
          });
        }
      }
    });

  // task:patch - Apply SEARCH/REPLACE blocks to task
  task.command('patch <id>')
    .description('Apply SEARCH/REPLACE blocks to task (stdin or file)')
    .option('-f, --file <path>', 'Read patch from file instead of stdin')
    .option('--dry-run', 'Show what would be changed without applying')
    .option('--json', 'JSON output')
    .action(async (id, options) => {
      const normalizedId = normalizeId(id);
      const taskPath = findTaskFile(normalizedId);

      if (!taskPath) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      // Read patch content
      let patchContent;
      if (options.file) {
        if (!fs.existsSync(options.file)) {
          console.error(`Patch file not found: ${options.file}`);
          process.exit(1);
        }
        patchContent = fs.readFileSync(options.file, 'utf8');
      } else {
        // Read from stdin
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

      const result = editArtifact(taskPath, ops);

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

  // task:edit - Edit task sections
  task.command('edit <id>')
    .description('Edit task section(s)')
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
    .action(async (id, options) => {
      const normalizedId = normalizeId(id);
      const taskPath = findTaskFile(normalizedId);

      if (!taskPath) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      let content = options.content;
      if (!content) {
        content = await new Promise((resolve) => {
          let data = '';
          if (process.stdin.isTTY) { resolve(''); return; }
          process.stdin.setEncoding('utf8');
          process.stdin.on('readable', () => {
            let chunk; while ((chunk = process.stdin.read()) !== null) data += chunk;
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

      let ops = options.section
        ? [{ op: opType, section: options.section, content }]
        : parseMultiSectionContent(content, opType);

      if (ops.length === 0) {
        console.error('No sections found. Use --section or format stdin with ## headers');
        process.exit(1);
      }

      const originalOps = ops.map(o => ({ op: o.op, section: o.section }));
      const { expandedOps, errors: processErrors } = processMultiSectionOps(taskPath, ops);
      if (processErrors.length > 0) {
        processErrors.forEach(e => console.error(e));
        process.exit(1);
      }

      const result = editArtifact(taskPath, expandedOps);

      if (options.json) {
        jsonOut({ id: normalizedId, ...result });
      } else if (result.success) {
        if (originalOps.length === 1) {
          console.log(`✓ ${originalOps[0].op} on ${originalOps[0].section} in ${normalizedId}`);
        } else {
          const byOp = {};
          originalOps.forEach(o => { byOp[o.op] = (byOp[o.op] || 0) + 1; });
          const summary = Object.entries(byOp).map(([op, n]) => `${op}:${n}`).join(', ');
          console.log(`✓ ${originalOps.length} sections in ${normalizedId} (${summary})`);
        }
      } else {
        console.error(`✗ Failed: ${result.errors.join(', ')}`);
        process.exit(1);
      }
    });
}
