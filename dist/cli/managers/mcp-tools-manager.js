import { runRudder, log } from './mcp-manager.js';
import { getConductorManager } from './conductor-manager.js';
import { getAllPrds, getAllTasks, getTask } from './artefacts-manager.js';
import { buildDependencyGraph, blockersResolved } from './graph-manager.js';
import { composeContext } from './compose-manager.js';
import { getAllVersions } from './version-manager.js';
function detectType(id) {
    if (/^T\d+$/i.test(id))
        return 'task';
    if (/^E\d+$/i.test(id))
        return 'epic';
    if (/^PRD-?\d+$/i.test(id))
        return 'prd';
    if (/^S\d+$/i.test(id))
        return 'story';
    return 'unknown';
}
function normalizeId(id) {
    return id.toUpperCase().replace(/^PRD(\d)/, 'PRD-$1');
}
// =============================================================================
// Response Helpers
// =============================================================================
export function ok(result) {
    return {
        content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
            }]
    };
}
export function err(message, nextActions) {
    const result = {
        success: false,
        error: message,
        next_actions: nextActions
    };
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: true
    };
}
export function fromRunResult(result, nextActions) {
    if (result.success) {
        // Try to parse JSON output
        let data = result.output || '';
        try {
            data = JSON.parse(result.output || '');
        }
        catch { /* keep as string */ }
        return ok({
            success: true,
            data,
            next_actions: nextActions
        });
    }
    return err(`${result.error}\n${result.stderr || ''}`, nextActions);
}
// =============================================================================
// Agent Tools (Limited - for sandbox agents)
// =============================================================================
export const AGENT_TOOLS = [
    {
        tool: {
            name: 'task_log',
            description: 'Log message for task execution',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID (T001)' },
                    message: { type: 'string', description: 'Log message' },
                    level: { type: 'string', enum: ['info', 'tip', 'warn', 'error', 'critical'], description: 'Log level' },
                    file: { type: 'string', description: 'Related file path' },
                    command: { type: 'string', description: 'Related command' }
                },
                required: ['task_id', 'message']
            }
        },
        handler: (args) => {
            let cmd = `task:log ${args.task_id} "${args.message.replace(/"/g, '\\"')}"`;
            if (args.level)
                cmd += ` --${args.level}`;
            if (args.file)
                cmd += ` -f "${args.file}"`;
            if (args.command)
                cmd += ` -c "${args.command}"`;
            return fromRunResult(runRudder(cmd));
        }
    },
    {
        tool: {
            name: 'artefact_show',
            description: 'Get artefact details (task, epic, prd, story)',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Artefact ID (T001, E001, PRD-001, S001)' },
                    raw: { type: 'boolean', description: 'Include raw markdown body' }
                },
                required: ['id']
            }
        },
        handler: (args) => {
            const id = normalizeId(args.id);
            const type = detectType(id);
            const cmdMap = {
                task: `task:show ${id} --json`,
                epic: `epic:show ${id} --json`,
                prd: `prd:show ${id} --json`,
                story: `story:show ${id} --json`,
                unknown: ''
            };
            if (type === 'unknown') {
                return err(`Cannot detect artefact type from ID: ${id}`);
            }
            const cmd = args.raw ? cmdMap[type].replace('--json', '--raw') : cmdMap[type];
            return fromRunResult(runRudder(cmd, { json: false }));
        }
    },
    {
        tool: {
            name: 'deps_show',
            description: 'Get dependencies for task or epic',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Task or Epic ID (T001, E001)' }
                },
                required: ['id']
            }
        },
        handler: (args) => {
            const id = normalizeId(args.id);
            return fromRunResult(runRudder(`deps:show ${id} --json`, { json: false }));
        }
    },
    {
        tool: {
            name: 'context_load',
            description: 'Load execution context for operation',
            inputSchema: {
                type: 'object',
                properties: {
                    operation: { type: 'string', description: 'Operation name or task ID' },
                    role: { type: 'string', enum: ['agent', 'skill'], description: 'Role (default: agent)' }
                },
                required: ['operation']
            }
        },
        handler: (args) => {
            return fromRunResult(runRudder(`context:load ${args.operation} --role ${args.role || 'agent'}`));
        }
    },
    {
        tool: {
            name: 'memory_read',
            description: 'Read memory hierarchy (project → PRD → epic)',
            inputSchema: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: 'Scope: PROJECT, PRD-001, E001, or T001' },
                    full: { type: 'boolean', description: 'Include all sections (default: agent-relevant only)' }
                },
                required: ['scope']
            }
        },
        handler: (args) => {
            let cmd = `memory:show ${args.scope}`;
            if (args.full)
                cmd += ' --full';
            cmd += ' --json';
            return fromRunResult(runRudder(cmd, { json: false }));
        }
    },
    {
        tool: {
            name: 'system_status',
            description: 'Get project status overview',
            inputSchema: { type: 'object', properties: {} }
        },
        handler: () => {
            const prds = getAllPrds();
            const tasks = getAllTasks();
            const conductor = getConductorManager();
            const agentsRecord = conductor.getAllAgents();
            const agentsList = Object.values(agentsRecord);
            const byStatus = {};
            tasks.forEach(t => {
                const status = t.data?.status || 'Unknown';
                byStatus[status] = (byStatus[status] || 0) + 1;
            });
            return ok({
                success: true,
                data: {
                    prds: prds.length,
                    tasks: { total: tasks.length, byStatus },
                    agents: {
                        total: agentsList.length,
                        running: agentsList.filter(a => a.status === 'running' || a.status === 'spawned').length
                    }
                }
            });
        }
    }
];
// =============================================================================
// Conductor Tools (Full - for orchestrator)
// =============================================================================
export const CONDUCTOR_TOOLS = [
    // ========== ARTEFACT (generic) ==========
    {
        tool: {
            name: 'artefact_list',
            description: 'List artefacts by type and filters',
            inputSchema: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['task', 'epic', 'prd', 'story'], description: 'Artefact type' },
                    scope: { type: 'string', description: 'Filter scope (PRD-001 for epics, E001 for tasks)' },
                    status: { type: 'string', description: 'Filter by status' },
                    limit: { type: 'number', description: 'Limit results' }
                },
                required: ['type']
            }
        },
        handler: (args) => {
            const { type, scope, status, limit } = args;
            let cmd = `${type}:list`;
            if (scope)
                cmd += ` ${scope}`;
            if (status)
                cmd += ` --status "${status}"`;
            if (limit)
                cmd += ` --limit ${limit}`;
            cmd += ' --json';
            const result = runRudder(cmd, { json: false });
            const nextActions = [];
            if (result.success && type === 'prd') {
                nextActions.push({
                    tool: 'artefact_list',
                    args: { type: 'epic', scope: 'PRD-001' },
                    reason: 'List epics for a specific PRD',
                    priority: 'normal'
                });
            }
            return fromRunResult(result, nextActions);
        }
    },
    {
        tool: {
            name: 'artefact_show',
            description: 'Get artefact details with full content',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Artefact ID (T001, E001, PRD-001, S001)' },
                    raw: { type: 'boolean', description: 'Include raw markdown body' }
                },
                required: ['id']
            }
        },
        handler: (args) => {
            const id = normalizeId(args.id);
            const type = detectType(id);
            if (type === 'unknown') {
                return err(`Cannot detect artefact type from ID: ${id}`);
            }
            const cmd = args.raw
                ? `${type}:show ${id} --raw`
                : `${type}:show ${id} --json`;
            const result = runRudder(cmd, { json: false });
            const nextActions = [];
            // Suggest editing empty sections
            if (result.success && !args.raw) {
                try {
                    const data = JSON.parse(result.output || '{}');
                    if (type === 'epic' && !data.technical_notes) {
                        nextActions.push({
                            tool: 'artefact_edit',
                            args: { id, section: 'Technical Notes', content: '' },
                            reason: 'Technical Notes section is empty',
                            priority: 'high'
                        });
                    }
                    if (type === 'task' && !data.deliverables) {
                        nextActions.push({
                            tool: 'artefact_edit',
                            args: { id, section: 'Deliverables', content: '' },
                            reason: 'Deliverables section is empty',
                            priority: 'high'
                        });
                    }
                }
                catch { /* ignore parse errors */ }
            }
            return fromRunResult(result, nextActions);
        }
    },
    {
        tool: {
            name: 'artefact_create',
            description: 'Create new artefact (task, epic, prd, story)',
            inputSchema: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: ['task', 'epic', 'prd', 'story'], description: 'Artefact type' },
                    parent: { type: 'string', description: 'Parent ID (E001 for task, PRD-001 for epic/story)' },
                    title: { type: 'string', description: 'Title' },
                    tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add' }
                },
                required: ['type', 'title']
            }
        },
        handler: (args) => {
            const { type, parent, title, tags } = args;
            // Validate parent requirement
            if ((type === 'task' || type === 'epic' || type === 'story') && !parent) {
                return err(`Parent ID required for ${type} creation`, [{
                        tool: 'artefact_list',
                        args: { type: type === 'task' ? 'epic' : 'prd' },
                        reason: `List available parents for ${type}`,
                        priority: 'high'
                    }]);
            }
            let cmd = `${type}:create`;
            if (parent)
                cmd += ` ${parent}`;
            cmd += ` "${title.replace(/"/g, '\\"')}"`;
            if (tags?.length) {
                tags.forEach((t) => { cmd += ` --tag ${t}`; });
            }
            cmd += ' --json';
            const result = runRudder(cmd, { json: false });
            const nextActions = [];
            if (result.success) {
                // Parse created ID from output
                try {
                    const data = JSON.parse(result.output || '{}');
                    const createdId = data.id || data.taskId || data.epicId || data.prdId;
                    if (createdId) {
                        nextActions.push({
                            tool: 'artefact_edit',
                            args: { id: createdId, section: 'Description', content: '' },
                            reason: 'Add description to newly created artefact',
                            priority: 'high'
                        });
                        if (type === 'epic') {
                            nextActions.push({
                                tool: 'artefact_edit',
                                args: { id: createdId, section: 'Acceptance Criteria', content: '' },
                                reason: 'Define acceptance criteria',
                                priority: 'high'
                            });
                        }
                        if (type === 'task') {
                            nextActions.push({
                                tool: 'artefact_edit',
                                args: { id: createdId, section: 'Deliverables', content: '' },
                                reason: 'Define deliverables',
                                priority: 'high'
                            });
                        }
                    }
                }
                catch { /* ignore */ }
            }
            return fromRunResult(result, nextActions);
        }
    },
    {
        tool: {
            name: 'artefact_update',
            description: 'Update artefact frontmatter (status, assignee, etc.)',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Artefact ID' },
                    status: { type: 'string', description: 'New status' },
                    assignee: { type: 'string', description: 'New assignee' },
                    title: { type: 'string', description: 'New title' },
                    effort: { type: 'string', description: 'Effort estimate (tasks only)' },
                    priority: { type: 'string', description: 'Priority (tasks only)' },
                    set: { type: 'object', description: 'Additional frontmatter fields to set' }
                },
                required: ['id']
            }
        },
        handler: (args) => {
            const id = normalizeId(args.id);
            const type = detectType(id);
            if (type === 'unknown') {
                return err(`Cannot detect artefact type from ID: ${id}`);
            }
            let cmd = `${type}:update ${id}`;
            if (args.status)
                cmd += ` --status "${args.status}"`;
            if (args.assignee)
                cmd += ` --assignee "${args.assignee}"`;
            if (args.title)
                cmd += ` --title "${args.title}"`;
            if (args.effort && type === 'task')
                cmd += ` --effort ${args.effort}`;
            if (args.priority && type === 'task')
                cmd += ` --priority ${args.priority}`;
            if (args.set) {
                Object.entries(args.set).forEach(([k, v]) => {
                    cmd += ` --set ${k}=${v}`;
                });
            }
            cmd += ' --json';
            return fromRunResult(runRudder(cmd, { json: false }));
        }
    },
    {
        tool: {
            name: 'artefact_edit',
            description: 'Edit artefact body section (no SEARCH/REPLACE needed)',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Artefact ID' },
                    section: { type: 'string', description: 'Section name (Description, Deliverables, Acceptance Criteria, Technical Notes, etc.)' },
                    content: { type: 'string', description: 'New section content' },
                    mode: { type: 'string', enum: ['replace', 'append', 'prepend'], description: 'Edit mode (default: replace)' }
                },
                required: ['id', 'section', 'content']
            }
        },
        handler: (args) => {
            const id = normalizeId(args.id);
            const type = detectType(id);
            if (type === 'unknown') {
                return err(`Cannot detect artefact type from ID: ${id}`);
            }
            const mode = args.mode || 'replace';
            const modeFlag = mode === 'append' ? ' --append' : mode === 'prepend' ? ' --prepend' : '';
            // Use edit command with stdin for content
            const cmd = `${type}:edit ${id} --section "${args.section}"${modeFlag} --json`;
            // For now, use patch format internally (the CLI edit command handles this)
            const result = runRudder(`${type}:edit ${id} --section "${args.section}" --content "${args.content.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"${modeFlag} --json`, { json: false });
            return fromRunResult(result);
        }
    },
    // ========== WORKFLOW ==========
    {
        tool: {
            name: 'workflow_ready',
            description: 'Get ready tasks (unblocked, not started) with impact scores',
            inputSchema: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: 'Filter by PRD-001 or E001' },
                    limit: { type: 'number', description: 'Max results (default: 6)' },
                    include_started: { type: 'boolean', description: 'Include In Progress tasks for resume' }
                }
            }
        },
        handler: (args) => {
            let cmd = 'deps:ready';
            if (args.scope) {
                const type = detectType(args.scope);
                if (type === 'prd')
                    cmd += ` --prd ${args.scope}`;
                else if (type === 'epic')
                    cmd += ` --epic ${args.scope}`;
            }
            cmd += ` --limit ${args.limit || 6}`;
            if (args.include_started)
                cmd += ' --include-started';
            cmd += ' --json';
            const result = runRudder(cmd, { json: false });
            const nextActions = [];
            if (result.success) {
                try {
                    const tasks = JSON.parse(result.output || '[]');
                    if (tasks.length > 0) {
                        nextActions.push({
                            tool: 'workflow_start',
                            args: { task_id: tasks[0].id || tasks[0].taskId },
                            reason: `Start highest impact task`,
                            priority: 'high'
                        });
                    }
                    if (tasks.length === 0) {
                        nextActions.push({
                            tool: 'memory_status',
                            args: {},
                            reason: 'No ready tasks - check if logs need consolidation',
                            priority: 'normal'
                        });
                    }
                }
                catch { /* ignore */ }
            }
            return fromRunResult(result, nextActions);
        }
    },
    {
        tool: {
            name: 'workflow_validate',
            description: 'Validate dependencies and optionally auto-fix issues',
            inputSchema: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: 'Filter by PRD' },
                    fix: { type: 'boolean', description: 'Auto-fix issues' }
                }
            }
        },
        handler: (args) => {
            let cmd = 'deps:validate';
            if (args.scope)
                cmd += ` --prd ${args.scope}`;
            if (args.fix)
                cmd += ' --fix';
            cmd += ' --json';
            const result = runRudder(cmd, { json: false });
            const nextActions = [];
            if (result.success) {
                nextActions.push({
                    tool: 'workflow_ready',
                    args: { scope: args.scope },
                    reason: 'Find tasks ready to start after validation',
                    priority: 'normal'
                });
            }
            return fromRunResult(result, nextActions);
        }
    },
    {
        tool: {
            name: 'workflow_start',
            description: 'Start task (atomically sets status + assignee + checks blockers)',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID' },
                    assignee: { type: 'string', description: 'Assignee (default: agent)' }
                },
                required: ['task_id']
            }
        },
        handler: (args) => {
            const id = normalizeId(args.task_id);
            const assignee = args.assignee || 'agent';
            // Use task:start which does status + assignee + blocker check
            const result = runRudder(`task:start ${id} --assignee "${assignee}" --json`, { json: false });
            const nextActions = [];
            if (result.success) {
                nextActions.push({
                    tool: 'agent_spawn',
                    args: { task_id: id },
                    reason: 'Spawn agent to execute task',
                    priority: 'high'
                });
            }
            return fromRunResult(result, nextActions);
        }
    },
    {
        tool: {
            name: 'workflow_complete',
            description: 'Complete task (atomically sets Done + logs message)',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID' },
                    message: { type: 'string', description: 'Completion message' }
                },
                required: ['task_id']
            }
        },
        handler: (args) => {
            const id = normalizeId(args.task_id);
            let cmd = `task:done ${id}`;
            if (args.message)
                cmd += ` --message "${args.message.replace(/"/g, '\\"')}"`;
            cmd += ' --json';
            const result = runRudder(cmd, { json: false });
            const nextActions = [];
            if (result.success) {
                // Get epic from task to suggest memory sync
                const task = getTask(id);
                const epicId = task?.data?.parent?.match(/E\d+/)?.[0];
                nextActions.push({
                    tool: 'workflow_ready',
                    args: { scope: epicId },
                    reason: 'Check for newly unblocked tasks',
                    priority: 'high'
                });
                nextActions.push({
                    tool: 'memory_status',
                    args: { scope: epicId },
                    reason: 'Check if logs need consolidation',
                    priority: 'normal'
                });
            }
            return fromRunResult(result, nextActions);
        }
    },
    // ========== AGENT ==========
    {
        tool: {
            name: 'agent_spawn',
            description: 'Spawn agent for task execution',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID' },
                    timeout: { type: 'number', description: 'Timeout in seconds' },
                    resume: { type: 'boolean', description: 'Resume existing worktree' },
                    worktree: { type: 'boolean', description: 'Use git worktree isolation' }
                },
                required: ['task_id']
            }
        },
        handler: async (args) => {
            const conductor = getConductorManager();
            const result = await conductor.spawn(normalizeId(args.task_id), {
                timeout: args.timeout,
                resume: args.resume,
                worktree: args.worktree
            });
            const nextActions = [];
            if (result.success) {
                nextActions.push({
                    tool: 'agent_status',
                    args: { task_id: args.task_id },
                    reason: 'Monitor agent progress',
                    priority: 'normal'
                });
            }
            return ok({
                success: result.success,
                data: result,
                error: result.error,
                next_actions: nextActions
            });
        }
    },
    {
        tool: {
            name: 'agent_reap',
            description: 'Reap agent (wait, merge work, cleanup)',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID' },
                    wait: { type: 'boolean', description: 'Wait for agent to finish' },
                    timeout: { type: 'number', description: 'Wait timeout in seconds' }
                },
                required: ['task_id']
            }
        },
        handler: async (args) => {
            const conductor = getConductorManager();
            const result = await conductor.reap(normalizeId(args.task_id), {
                wait: args.wait,
                timeout: args.timeout
            });
            const nextActions = [];
            if (result.success) {
                nextActions.push({
                    tool: 'workflow_ready',
                    args: {},
                    reason: 'Find next tasks to work on',
                    priority: 'high'
                });
                nextActions.push({
                    tool: 'memory_status',
                    args: {},
                    reason: 'Check memory consolidation status',
                    priority: 'normal'
                });
            }
            return ok({
                success: result.success,
                data: result,
                error: result.error,
                next_actions: nextActions
            });
        }
    },
    {
        tool: {
            name: 'agent_kill',
            description: 'Kill agent process',
            inputSchema: {
                type: 'object',
                properties: { task_id: { type: 'string', description: 'Task ID' } },
                required: ['task_id']
            }
        },
        handler: async (args) => {
            const conductor = getConductorManager();
            const result = await conductor.kill(normalizeId(args.task_id));
            return ok({ success: result.success, data: result, error: result.error });
        }
    },
    {
        tool: {
            name: 'agent_status',
            description: 'Get agent execution status',
            inputSchema: {
                type: 'object',
                properties: { task_id: { type: 'string', description: 'Task ID' } },
                required: ['task_id']
            }
        },
        handler: (args) => {
            const conductor = getConductorManager();
            const status = conductor.getStatus(normalizeId(args.task_id));
            if (!status) {
                return err('Agent not found');
            }
            const nextActions = [];
            if (status.status === 'completed' || status.status === 'error') {
                nextActions.push({
                    tool: 'agent_reap',
                    args: { task_id: args.task_id },
                    reason: 'Agent finished - reap to merge work',
                    priority: 'high'
                });
            }
            return ok({ success: true, data: status, next_actions: nextActions });
        }
    },
    {
        tool: {
            name: 'agent_log',
            description: 'Get agent output log',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID' },
                    tail: { type: 'number', description: 'Number of lines from end' }
                },
                required: ['task_id']
            }
        },
        handler: (args) => {
            const conductor = getConductorManager();
            const lines = conductor.getLog(normalizeId(args.task_id), { tail: args.tail });
            return ok({ success: true, data: { lines, count: lines.length } });
        }
    },
    {
        tool: {
            name: 'agent_list',
            description: 'List all agents',
            inputSchema: {
                type: 'object',
                properties: {
                    status: { type: 'string', description: 'Filter by status (spawned, running, completed, error)' }
                }
            }
        },
        handler: (args) => {
            const conductor = getConductorManager();
            const agents = args.status
                ? conductor.getAgentsByStatus(args.status)
                : conductor.getAllAgents();
            return ok({ success: true, data: agents });
        }
    },
    // ========== MEMORY ==========
    {
        tool: {
            name: 'memory_read',
            description: 'Read memory hierarchy (project → PRD → epic)',
            inputSchema: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: 'Scope: PROJECT, PRD-001, E001, or T001' },
                    full: { type: 'boolean', description: 'Include all sections' }
                },
                required: ['scope']
            }
        },
        handler: (args) => {
            let cmd = `memory:show ${args.scope}`;
            if (args.full)
                cmd += ' --full';
            cmd += ' --json';
            return fromRunResult(runRudder(cmd, { json: false }));
        }
    },
    {
        tool: {
            name: 'memory_write',
            description: 'Add entry to epic memory',
            inputSchema: {
                type: 'object',
                properties: {
                    epic_id: { type: 'string', description: 'Epic ID (E001)' },
                    category: { type: 'string', enum: ['tip', 'issue', 'command', 'solution'], description: 'Entry category' },
                    content: { type: 'string', description: 'Memory content' }
                },
                required: ['epic_id', 'category', 'content']
            }
        },
        handler: (args) => {
            const cmd = `epic:memory ${args.epic_id} "${args.content.replace(/"/g, '\\"')}" --${args.category}`;
            return fromRunResult(runRudder(cmd));
        }
    },
    {
        tool: {
            name: 'memory_status',
            description: 'Check memory consolidation status (pending logs)',
            inputSchema: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: 'Filter by PRD or Epic' }
                }
            }
        },
        handler: (args) => {
            let cmd = 'memory:sync';
            if (args.scope)
                cmd += ` ${args.scope}`;
            cmd += ' --json';
            const result = runRudder(cmd, { json: false });
            const nextActions = [];
            if (result.success) {
                try {
                    const data = JSON.parse(result.output || '{}');
                    if (data.pending_count > 0 || data.needs_sync) {
                        nextActions.push({
                            tool: 'memory_read',
                            args: { scope: args.scope || 'PROJECT', full: true },
                            reason: 'Review pending logs before consolidation',
                            priority: 'high'
                        });
                    }
                }
                catch { /* ignore */ }
            }
            return fromRunResult(result, nextActions);
        }
    },
    // ========== DEPS ==========
    {
        tool: {
            name: 'deps_show',
            description: 'Get dependencies for task or epic',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Task or Epic ID' }
                },
                required: ['id']
            }
        },
        handler: (args) => {
            const id = normalizeId(args.id);
            const { tasks, blocks } = buildDependencyGraph();
            const task = tasks.get(id);
            if (!task) {
                return err(`Not found: ${id}`);
            }
            const blockers = task.blockedBy || [];
            const dependents = [...blocks.entries()]
                .filter(([_, blockedBy]) => blockedBy.includes(id))
                .map(([taskId]) => taskId);
            return ok({
                success: true,
                data: {
                    id,
                    blockers,
                    blockers_resolved: blockersResolved(task, tasks),
                    dependents,
                    impact: dependents.length
                }
            });
        }
    },
    {
        tool: {
            name: 'deps_add',
            description: 'Add dependency between tasks',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID' },
                    blocked_by: { type: 'string', description: 'Blocking task ID' }
                },
                required: ['task_id', 'blocked_by']
            }
        },
        handler: (args) => {
            const result = runRudder(`deps:add ${normalizeId(args.task_id)} --blocked-by ${normalizeId(args.blocked_by)}`);
            const nextActions = [{
                    tool: 'workflow_validate',
                    args: {},
                    reason: 'Validate dependency graph after adding',
                    priority: 'normal'
                }];
            return fromRunResult(result, nextActions);
        }
    },
    // ========== CONTEXT ==========
    {
        tool: {
            name: 'context_load',
            description: 'Load execution context for operation',
            inputSchema: {
                type: 'object',
                properties: {
                    operation: { type: 'string', description: 'Operation name or task ID' },
                    role: { type: 'string', enum: ['agent', 'skill', 'coordinator'], description: 'Role (default: coordinator)' }
                },
                required: ['operation']
            }
        },
        handler: (args) => {
            const result = composeContext({
                operation: args.operation,
                role: args.role || 'coordinator'
            });
            if (!result) {
                return err(`Failed to load context: ${args.operation}`);
            }
            return ok({ success: true, data: { content: result.content } });
        }
    },
    // ========== SYSTEM ==========
    {
        tool: {
            name: 'system_status',
            description: 'Get project status overview',
            inputSchema: { type: 'object', properties: {} }
        },
        handler: () => {
            const prds = getAllPrds();
            const tasks = getAllTasks();
            const conductor = getConductorManager();
            const agentsRecord = conductor.getAllAgents();
            const agentsList = Object.values(agentsRecord);
            const byStatus = {};
            tasks.forEach(t => {
                const status = t.data?.status || 'Unknown';
                byStatus[status] = (byStatus[status] || 0) + 1;
            });
            const nextActions = [];
            if (byStatus['In Progress'] > 0) {
                nextActions.push({
                    tool: 'agent_list',
                    args: { status: 'running' },
                    reason: 'Check running agents',
                    priority: 'normal'
                });
            }
            nextActions.push({
                tool: 'workflow_ready',
                args: {},
                reason: 'Find tasks ready to start',
                priority: 'normal'
            });
            return ok({
                success: true,
                data: {
                    prds: prds.length,
                    tasks: { total: tasks.length, byStatus },
                    agents: {
                        total: agentsList.length,
                        running: agentsList.filter(a => a.status === 'running' || a.status === 'spawned').length
                    }
                },
                next_actions: nextActions
            });
        }
    },
    {
        tool: {
            name: 'system_versions',
            description: 'Get component versions',
            inputSchema: { type: 'object', properties: {} }
        },
        handler: () => {
            const versions = getAllVersions();
            return ok({ success: true, data: versions });
        }
    },
    {
        tool: {
            name: 'system_help',
            description: 'List all available tools by category',
            inputSchema: { type: 'object', properties: {} }
        },
        handler: () => {
            const toolsByCategory = {};
            CONDUCTOR_TOOLS.forEach(t => {
                const [cat] = t.tool.name.split('_');
                if (!toolsByCategory[cat])
                    toolsByCategory[cat] = [];
                toolsByCategory[cat].push({
                    name: t.tool.name,
                    description: t.tool.description || ''
                });
            });
            return ok({
                success: true,
                data: {
                    categories: Object.keys(toolsByCategory),
                    tools: toolsByCategory,
                    total: CONDUCTOR_TOOLS.length
                }
            });
        }
    }
];
// =============================================================================
// Tool Lookup
// =============================================================================
const agentToolMap = new Map(AGENT_TOOLS.map(t => [t.tool.name, t]));
const conductorToolMap = new Map(CONDUCTOR_TOOLS.map(t => [t.tool.name, t]));
export function getAgentTools() {
    return AGENT_TOOLS.map(t => t.tool);
}
export function getConductorTools() {
    return CONDUCTOR_TOOLS.map(t => t.tool);
}
export async function handleAgentTool(name, args) {
    const toolDef = agentToolMap.get(name);
    if (!toolDef) {
        return err(`Unknown agent tool: ${name}`);
    }
    try {
        log('INFO', `Agent tool: ${name}`, args);
        return await toolDef.handler(args);
    }
    catch (error) {
        log('ERROR', `Agent tool failed: ${name}`, { error: error.message });
        return err(error.message);
    }
}
export async function handleConductorTool(name, args) {
    const toolDef = conductorToolMap.get(name);
    if (!toolDef) {
        return err(`Unknown conductor tool: ${name}`);
    }
    try {
        log('INFO', `Conductor tool: ${name}`, args);
        return await toolDef.handler(args);
    }
    catch (error) {
        log('ERROR', `Conductor tool failed: ${name}`, { error: error.message });
        return err(error.message);
    }
}
// =============================================================================
// Help Formatting (for CLI debug)
// =============================================================================
export function formatToolHelp(tools, verbose = false) {
    const lines = [];
    const byCategory = {};
    for (const t of tools) {
        const [cat] = t.tool.name.split('_');
        if (!byCategory[cat])
            byCategory[cat] = [];
        byCategory[cat].push(t);
    }
    for (const [cat, catTools] of Object.entries(byCategory)) {
        lines.push(`\n${cat.toUpperCase()}`);
        for (const t of catTools) {
            const schema = t.tool.inputSchema;
            const props = schema?.properties || {};
            const required = schema?.required || [];
            const argParts = [];
            for (const [name] of Object.entries(props)) {
                const isRequired = required.includes(name);
                argParts.push(`--${name}${isRequired ? '*' : ''}`);
            }
            lines.push(`  ${t.tool.name.padEnd(20)} ${t.tool.description}`);
            if (argParts.length > 0) {
                lines.push(`  ${''.padEnd(20)} ${argParts.join(' ')}`);
            }
            if (verbose) {
                for (const [name, prop] of Object.entries(props)) {
                    const isRequired = required.includes(name);
                    lines.push(`    --${name}${isRequired ? ' (required)' : ''}: ${prop.description || prop.type}`);
                }
            }
        }
    }
    return lines.join('\n');
}
export function getToolSchema(tools, toolName) {
    return tools.find(t => t.tool.name === toolName);
}
