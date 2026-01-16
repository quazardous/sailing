/**
 * Task commands for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, saveFile, toKebab, loadTemplate, jsonOut, getMemoryDir, stripComments } from '../managers/core-manager.js';
import { normalizeId, matchesPrdDir, parentContainsEpic } from '../lib/normalize.js';
import { getTask, getEpic, getEpicPrd, getAllTasks, getAllEpics } from '../managers/artefacts-manager.js';
import { getHierarchicalMemory, ensureMemoryDir, hasPendingMemoryLogs } from '../managers/memory-manager.js';
import { STATUS, normalizeStatus, isStatusDone, isStatusNotStarted, isStatusCancelled, statusSymbol } from '../lib/lexicon.js';
import { buildDependencyGraph, blockersResolved } from '../managers/graph-manager.js';
import { nextId } from '../managers/state-manager.js';
import { parseUpdateOptions, addLogEntry } from '../lib/update.js';
import { addDynamicHelp, withModifies } from '../lib/help.js';
import { formatId } from '../managers/core-manager.js';
import { escalateOnTaskStart, cascadeTaskCompletion } from '../managers/status-manager.js';
import { parseSearchReplace, editArtifact, parseMultiSectionContent, processMultiSectionOps } from '../lib/artifact.js';
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Find a task file by ID (format-agnostic via index.ts)
 */
function findTaskFile(taskId) {
    return getTask(taskId)?.file || null;
}
/**
 * Find PRD directory containing an epic (via index.ts)
 */
function findEpicParent(epicId) {
    const epic = getEpic(epicId);
    if (!epic)
        return null;
    const prdInfo = getEpicPrd(epic.id);
    return {
        prdDir: epic.prdDir,
        epicFile: epic.file,
        prdId: prdInfo?.prdId || 'unknown'
    };
}
// ============================================================================
// Command Registration
// ============================================================================
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
        .option('--path', 'Include file path (discouraged)')
        .option('--json', 'JSON output')
        .action((prdArg, options) => {
        const prd = prdArg || options.prd;
        const tasks = [];
        // Use artefacts.ts contract - single entry point
        for (const taskEntry of getAllTasks()) {
            // Extract prdDir from task file path
            const tasksDir = path.dirname(taskEntry.file);
            const prdDir = path.dirname(tasksDir);
            const prdName = path.basename(prdDir);
            // PRD filter
            if (prd && !matchesPrdDir(prdDir, prd))
                continue;
            const data = taskEntry.data;
            if (!data)
                continue;
            // Status filter
            if (options.status) {
                const targetStatus = normalizeStatus(options.status, 'task');
                const taskStatus = normalizeStatus(data.status, 'task');
                if (targetStatus !== taskStatus)
                    continue;
            }
            // Epic filter (format-agnostic: E1 matches E001 in parent)
            if (options.epic) {
                if (!parentContainsEpic(data.parent, options.epic))
                    continue;
            }
            // Assignee filter
            if (options.assignee) {
                const assignee = ((data.assignee) || '').toLowerCase();
                if (!assignee.includes(options.assignee.toLowerCase()))
                    continue;
            }
            // Tag filter (AND logic - all specified tags must be present)
            if (options.tag && options.tag.length > 0) {
                const taskTags = (data.tags) || [];
                const allTagsMatch = options.tag.every((t) => taskTags.includes(t));
                if (!allTagsMatch)
                    continue;
            }
            const taskResult = {
                id: (data.id) || taskEntry.id,
                title: (data.title) || '',
                status: (data.status) || 'Unknown',
                parent: (data.parent) || '',
                assignee: (data.assignee) || 'unassigned',
                effort: (data.effort) || null,
                priority: data.priority || 'normal',
                blocked_by: (data.blocked_by) || [],
                prd: prdName
            };
            if (options.path)
                taskResult.file = taskEntry.file;
            tasks.push(taskResult);
        }
        // Ready filter (unblocked AND not done/cancelled)
        let filtered = tasks;
        if (options.ready) {
            const { tasks: graphTasks } = buildDependencyGraph();
            filtered = tasks.filter(t => {
                // Exclude Done/Cancelled tasks
                if (isStatusDone(t.status) || isStatusCancelled(t.status))
                    return false;
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
        }
        else {
            if (limited.length === 0) {
                console.log('No tasks found.');
            }
            else {
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
        .option('--raw', 'Dump raw markdown')
        .option('--strip-comments', 'Strip template comments from output')
        .option('--path', 'Include file path (discouraged)')
        .option('--json', 'JSON output')
        .action((id, options) => {
        const taskFile = findTaskFile(id);
        if (!taskFile) {
            console.error(`Task not found: ${id}`);
            process.exit(1);
        }
        // Raw mode: dump file content
        if (options.raw) {
            if (options.path)
                console.log(`# File: ${taskFile}\n`);
            const content = fs.readFileSync(taskFile, 'utf8');
            console.log(options.stripComments ? stripComments(content) : content);
            return;
        }
        const file = loadFile(taskFile);
        const fileData = file?.data;
        const isAgentRole = options.role === 'agent';
        // Agent role: minimal output (just what's needed to execute)
        if (isAgentRole) {
            const result = {
                id: fileData?.id || '',
                title: fileData?.title || '',
                status: fileData?.status || '',
                parent: fileData?.parent || ''
            };
            if (options.path)
                result.file = taskFile;
            if (options.json) {
                jsonOut(result);
            }
            else {
                console.log(`# ${result.id}: ${result.title}\n`);
                console.log(`Status: ${result.status}`);
                console.log(`Parent: ${result.parent || '-'}`);
                console.log(`\n→ Use task:show-memory ${result.id} for Agent Context`);
                if (options.path) {
                    console.log(`→ Use Read tool on ${taskFile} for full deliverables`);
                }
                else {
                    console.log(`→ Use task:show ${result.id} --raw for full deliverables`);
                }
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
            ...fileData,
            blockers: task?.blockedBy || [],
            dependents,
            ready: isReady && !isStatusDone(fileData?.status || '')
        };
        if (options.path)
            result.file = taskFile;
        if (options.json) {
            jsonOut(result);
        }
        else {
            console.log(`# ${fileData?.id}: ${fileData?.title}\n`);
            console.log(`Status: ${fileData?.status}`);
            console.log(`Assignee: ${fileData?.assignee || 'unassigned'}`);
            console.log(`Effort: ${fileData?.effort || '-'}`);
            console.log(`Priority: ${fileData?.priority || 'normal'}`);
            console.log(`Parent: ${fileData?.parent || '-'}`);
            if (task?.blockedBy?.length > 0) {
                console.log(`\nBlocked by: ${task.blockedBy.join(', ')}`);
            }
            if (dependents.length > 0) {
                console.log(`Blocks: ${dependents.join(', ')}`);
            }
            if (result.ready) {
                console.log('\n✓ Ready to start');
            }
            if (options.path)
                console.log(`\nFile: ${taskFile}`);
        }
    });
    // task:create
    withModifies(task.command('create <parent> <title>'), ['task'])
        .description('Create task under epic (e.g., E035 or PRD-001/E035 "Title")')
        .option('--story <id>', 'Link to story (repeatable)', (v, arr) => arr.concat(v), [])
        .option('--tag <tag>', 'Add tag (repeatable, slugified to kebab-case)', (v, arr) => arr.concat(v), [])
        .option('--target-version <comp:ver>', 'Target version (repeatable)', (v, arr) => arr.concat(v), [])
        .option('--path', 'Show file path')
        .option('--json', 'JSON output')
        .action((parent, title, options) => {
        let prdDir;
        let epicPart;
        let prdId;
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
        }
        else {
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
                if (comp && ver)
                    data.target_versions[comp] = ver;
            });
        }
        // Load template or use minimal body
        let body = loadTemplate('task');
        if (body) {
            body = body.replace(/^---[\s\S]*?---\s*/, ''); // Remove template frontmatter
            body = body.replace(/# T00000: Task Title/g, `# ${id}: ${title}`);
        }
        else {
            body = `\n# ${id}: ${title}\n\n## Description\n\n[Add description]\n\n## Deliverables\n\n- [ ] [Deliverable 1]\n\n## Log\n`;
        }
        saveFile(taskPath, data, body);
        if (options.json) {
            const output = { id, title, parent: data.parent };
            if (options.path)
                output.file = taskPath;
            jsonOut(output);
        }
        else {
            console.log(`Created: ${id} - ${title}`);
            if (options.path)
                console.log(`File: ${taskPath}`);
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
        const fileData = file?.data;
        // Convert Commander options format
        // Merge --blocked-by (comma-separated) with --add-blocker (repeatable)
        let blockers = options.addBlocker || [];
        if (options.blockedBy) {
            const parsed = options.blockedBy.split(',').map((s) => s.trim()).filter(Boolean);
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
        const { updated, data } = parseUpdateOptions(opts, fileData, 'task');
        if (updated) {
            saveFile(taskFile, data, file.body);
            if (options.json) {
                jsonOut(data);
            }
            else {
                console.log(`Updated: ${data.id}`);
            }
        }
        else {
            console.log('No changes made.');
        }
    });
    // task:next
    task.command('next')
        .description('Get next ready task (unassigned, unblocked)')
        .option('--prd <id>', 'Filter by PRD (e.g., PRD-006)')
        .option('--epic <id>', 'Filter by epic (e.g., E035)')
        .option('--path', 'Include file path (discouraged)')
        .option('--json', 'JSON output')
        .action((options) => {
        const { tasks } = buildDependencyGraph();
        // Find ready tasks (not started, all blockers done, unassigned)
        const ready = [];
        for (const [id, task] of tasks) {
            // PRD filter
            if (options.prd) {
                const prdId = options.prd.toUpperCase().replace(/^PRD-?0*/, 'PRD-');
                if (!task.prd?.toUpperCase().includes(prdId.replace('PRD-', '')))
                    continue;
            }
            // Epic filter (format-agnostic: E1 matches E001 in parent)
            if (options.epic) {
                if (!parentContainsEpic(task.parent, options.epic))
                    continue;
            }
            if (isStatusNotStarted(task.status) &&
                task.assignee === 'unassigned' &&
                blockersResolved(task, tasks)) {
                ready.push({
                    id: task.id,
                    title: task.title,
                    status: task.status,
                    parent: task.parent,
                    assignee: task.assignee,
                    priority: task.priority,
                    prd: task.prd,
                    file: task.file
                });
            }
        }
        if (ready.length === 0) {
            if (options.json) {
                jsonOut({ task: null, message: 'No ready tasks' });
            }
            else {
                console.log('No ready tasks available.');
            }
            return;
        }
        // Sort by priority and ID
        const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
        ready.sort((a, b) => {
            const pa = (priorityOrder[a.priority]) ?? 2;
            const pb = (priorityOrder[b.priority]) ?? 2;
            if (pa !== pb)
                return pa - pb;
            const numA = parseInt(a.id.match(/\d+/)?.[0] || '0');
            const numB = parseInt(b.id.match(/\d+/)?.[0] || '0');
            return numA - numB;
        });
        const next = ready[0];
        // Check for pending memory (preflight)
        let pendingWarning = null;
        if (hasPendingMemoryLogs()) {
            pendingWarning = `⚠ PENDING LOGS: epic(s) need consolidation`;
        }
        if (options.json) {
            const output = { ...next, pendingMemory: !!pendingWarning };
            if (!options.path)
                delete output.file;
            jsonOut(output);
        }
        else {
            // Show warning first if pending
            if (pendingWarning) {
                console.log(pendingWarning);
                console.log(`→ Run: rudder memory:sync`);
                console.log(`→ Follow the aggregation instructions shown\n`);
            }
            console.log(`${next.id}: ${next.title}`);
            console.log(`PRD: ${next.prd}`);
            if (options.path)
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
        .option('--path', 'Include file path (discouraged)')
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
        // Auto-escalate: Epic and PRD to In Progress if not started
        const escalation = escalateOnTaskStart(data);
        if (escalation.epic?.updated) {
            console.log(`● ${escalation.epic.message}`);
        }
        if (escalation.prd?.updated) {
            console.log(`● ${escalation.prd.message}`);
        }
        if (options.json) {
            const output = { ...data };
            if (options.path)
                output.file = taskFile;
            jsonOut(output);
        }
        else {
            console.log(`Started: ${data.id} - ${data.title}`);
            console.log(`Status: ${data.status}`);
            console.log(`Assignee: ${data.assignee}`);
            if (options.path)
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
        // Cascade completion: check if Epic/PRD should be Auto-Done
        const cascade = cascadeTaskCompletion(id, data);
        if (cascade.epic?.updated) {
            console.log(`\n◉ ${cascade.epic.message}`);
        }
        if (cascade.prd?.updated) {
            console.log(`◉ ${cascade.prd.message}`);
        }
        if (options.json) {
            jsonOut(data);
        }
        else {
            console.log(`Completed: ${data.id} - ${data.title}`);
        }
    });
    // task:log
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
        if (options.tip)
            level = 'TIP';
        else if (options.warn)
            level = 'WARN';
        else if (options.error)
            level = 'ERROR';
        else if (options.critical)
            level = 'CRITICAL';
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
        if (options.file?.length)
            meta.files = options.file;
        if (options.snippet)
            meta.snippet = options.snippet;
        if (options.cmd)
            meta.cmd = options.cmd;
        if (Object.keys(meta).length > 0) {
            entry += ` {{${JSON.stringify(meta)}}}`;
        }
        entry += '\n';
        fs.appendFileSync(logFile, entry);
        // Output
        let output = `[${level}] ${taskId}: ${message}`;
        if (options.file?.length)
            output += ` (files: ${options.file.join(', ')})`;
        if (options.cmd)
            output += ` (cmd: ${options.cmd})`;
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
            epicId: epicParent?.prdId || null, // Use prdId as epicId is not directly available from findEpicParent
            memory: null,
            technicalNotes: null,
            dependencies: null
        };
        // 1. Hierarchical memory (epic → PRD → project)
        if (epicParent) {
            const epicFileData = loadFile(epicParent.epicFile); // Load epic file here
            if (epicFileData) {
                const hierarchy = getHierarchicalMemory(epicFileData.data.id);
                const memoryParts = [];
                // Extract agent-relevant sections
                const extractSections = (content, level) => {
                    if (!content)
                        return [];
                    const sections = [];
                    const regex = /^## ([^\n]+)\n([\s\S]*?)(?=\n## [A-Z]|$)/gm;
                    let match;
                    while ((match = regex.exec(content)) !== null) {
                        const name = match[1].trim();
                        const body = match[2].replace(/<!--[\s\S]*?-->/g, '').trim();
                        if (body)
                            sections.push({ level, name, content: body });
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
                const epicContent = epicFileData.body || '';
                const techNotesMatch = epicContent.match(/## Technical Notes\n([\s\S]*?)(?=\n## |$)/);
                if (techNotesMatch) {
                    context.technicalNotes = techNotesMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim();
                }
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
        const memoryArray = context.memory;
        if (memoryArray && memoryArray.length) {
            console.log(`\n${sep}`);
            console.log('## Memory (tips & learnings)\n');
            for (const sec of memoryArray) {
                console.log(`### [${sec.level}] ${sec.name}\n`);
                console.log(sec.content);
                console.log('');
            }
        }
        // Dependencies
        const deps = context.dependencies;
        if (deps) {
            console.log(`\n${sep}`);
            console.log('## Dependencies\n');
            console.log(`Blocked by: ${deps.blockedBy.join(', ')}`);
            console.log(`All resolved: ${deps.allResolved ? '✓' : '✗'}`);
        }
        if (!memoryArray?.length && !context.technicalNotes && !deps) {
            console.log('(No memory or context available for this task)');
        }
    });
    // task:targets - find tasks with target_versions for a component
    task.command('targets <component>')
        .description('Find tasks with target_versions for a component')
        .option('--path', 'Include file path (discouraged)')
        .option('--json', 'JSON output')
        .action((component, options) => {
        const results = [];
        // Use artefacts.ts contract - single entry point
        for (const taskEntry of getAllTasks()) {
            const data = taskEntry.data;
            if (data?.target_versions && data.target_versions[component]) {
                const entry = {
                    id: data.id,
                    title: data.title,
                    status: data.status,
                    target_version: data.target_versions[component]
                };
                if (options.path)
                    entry.file = taskEntry.file;
                results.push(entry);
            }
        }
        // Also check epics (artefacts.ts contract)
        for (const epicEntry of getAllEpics()) {
            const data = epicEntry.data;
            if (data?.target_versions && data.target_versions[component]) {
                const entry = {
                    id: data.id,
                    title: data.title,
                    status: data.status,
                    target_version: data.target_versions[component],
                    type: 'epic'
                };
                if (options.path)
                    entry.file = epicEntry.file;
                results.push(entry);
            }
        }
        if (options.json) {
            jsonOut(results);
        }
        else {
            if (results.length === 0) {
                console.log(`No tasks/epics target component: ${component}`);
            }
            else {
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
        }
        else {
            // Read from stdin
            patchContent = await new Promise((resolve) => {
                let data = '';
                if (process.stdin.isTTY) {
                    resolve('');
                    return;
                }
                process.stdin.setEncoding('utf8');
                process.stdin.on('readable', () => {
                    let chunk;
                    while ((chunk = process.stdin.read()) !== null)
                        data += chunk;
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
            }
            else {
                console.log(`Would apply ${ops.length} patch(es) to ${normalizedId}`);
            }
            return;
        }
        const result = editArtifact(taskPath, ops);
        if (options.json) {
            jsonOut({ id: normalizedId, ...result });
        }
        else if (result.success) {
            console.log(`✓ Applied ${result.applied} patch(es) to ${normalizedId}`);
        }
        else {
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
            const stdinContent = await new Promise((resolve) => {
                let data = '';
                if (process.stdin.isTTY) {
                    resolve('');
                    return;
                }
                process.stdin.setEncoding('utf8');
                process.stdin.on('readable', () => {
                    let chunk;
                    while ((chunk = process.stdin.read()) !== null)
                        data += chunk;
                });
                process.stdin.on('end', () => resolve(data));
            });
            content = stdinContent.trim();
        }
        if (!content) {
            console.error('Content required via --content or stdin');
            process.exit(1);
        }
        let opType = 'replace';
        if (options.append)
            opType = 'append';
        if (options.prepend)
            opType = 'prepend';
        const ops = options.section
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
        }
        else if (result.success) {
            if (originalOps.length === 1) {
                console.log(`✓ ${originalOps[0].op} on ${originalOps[0].section} in ${normalizedId}`);
            }
            else {
                const byOp = {};
                originalOps.forEach(o => { byOp[o.op] = ((byOp[o.op]) || 0) + 1; });
                const summary = Object.entries(byOp).map(([op, n]) => `${op}:${n}`).join(', ');
                console.log(`✓ ${originalOps.length} sections in ${normalizedId} (${summary})`);
            }
        }
        else {
            console.error(`✗ Failed: ${result.errors.join(', ')}`);
            process.exit(1);
        }
    });
}
