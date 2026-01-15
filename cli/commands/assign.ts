/**
 * Assignment commands for rudder CLI
 * Formalizes skill → agent prompt transmission
 * TODO[P2]: Harden file/frontmatter parsing (null checks) then tighten types on entity lookups.
 * TODO[P3]: Extract shared normalize/lookup helpers to shrink surface before TS migration.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { jsonOut, getPrompting, getMemoryDir, loadFile, getPrdsDir, saveFile, getPath, loadPathsConfig, getRunsDir, getAssignmentsDir } from '../lib/core.js';
import { ensureDir, computeProjectHash } from '../lib/paths.js';
import { normalizeId } from '../lib/normalize.js';
import { getTask, getEpic, getPrd } from '../lib/index.js';
import { addDynamicHelp, withModifies } from '../lib/help.js';
import { findLogFiles, mergeTaskLog, findTaskEpic, readLogFile } from '../lib/memory.js';
import { addLogEntry } from '../lib/update.js';
import { composeAgentContext } from '../lib/compose.js';

/**
 * Find task file by ID (via index.ts)
 */
function findTaskFile(taskId) {
  return getTask(taskId)?.file || null;
}

/**
 * Find epic file by ID (via index.ts)
 */
function findEpicFile(epicId) {
  return getEpic(epicId)?.file || null;
}

/**
 * Find PRD file by ID (via index.ts)
 */
function findPrdFile(prdId) {
  return getPrd(prdId)?.file || null;
}

/**
 * Detect entity type from ID
 * @returns {{ type: 'task'|'epic'|'prd', id: string }}
 */
function detectEntityType(id) {
  const normalized = normalizeId(id);
  if (normalized.startsWith('T')) {
    return { type: 'task', id: normalized };
  } else if (normalized.startsWith('E')) {
    return { type: 'epic', id: normalized };
  } else if (normalized.startsWith('PRD-') || normalized.match(/^PRD\d+$/i)) {
    return { type: 'prd', id: normalized };
  }
  return { type: 'unknown', id: normalized };
}

/**
 * Get PRD details for prompt
 */
function getPrdDetails(prdId) {
  const prdFile = findPrdFile(prdId);
  if (!prdFile) return null;

  const raw = fs.readFileSync(prdFile, 'utf8');
  return raw;
}

/**
 * Get epic details for prompt (full file)
 */
function getEpicDetails(epicId) {
  const epicFile = findEpicFile(epicId);
  if (!epicFile) return null;

  const raw = fs.readFileSync(epicFile, 'utf8');
  return raw;
}

// Note: getAssignmentsDir() and getRunsDir() are imported from core.js
// They handle path resolution and placeholders centrally

/**
 * Get run file path for a task
 */
function runFilePath(taskId) {
  const dir = getRunsDir();
  return path.join(dir, `${taskId}.run`);
}

/**
 * Check if run file exists (agent is running)
 */
function isRunning(taskId) {
  return fs.existsSync(runFilePath(taskId));
}

/**
 * Create run file (mark agent as running)
 */
function createRunFile(taskId, operation) {
  const filePath = runFilePath(taskId);
  ensureDir(path.dirname(filePath));
  const data = {
    taskId,
    operation,
    started_at: new Date().toISOString(),
    pid: process.pid
  };
  fs.writeFileSync(filePath, yaml.dump(data));
  return filePath;
}

/**
 * Remove run file (agent finished)
 */
function removeRunFile(taskId) {
  const filePath = runFilePath(taskId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Check if a process is still running
 */
function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);  // Signal 0 = check if process exists
    return true;
  } catch (e) {
    return false;  // ESRCH = no such process
  }
}

/**
 * List orphan run files (runs where the agent process is dead)
 * Active agents (PID alive) are NOT orphans
 */
function findOrphanRuns() {
  const dir = getRunsDir();
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.run'))
    .map(f => {
      const content = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
      return { taskId: content.taskId, file: f, ...content };
    })
    .filter(run => !isPidAlive(run.pid));  // Only orphans = dead PIDs
}

/**
 * Check for pending memory (logs not consolidated)
 * Returns { pending: boolean, epics: string[] }
 */
function checkPendingMemory(epicId = null) {
  // Merge task logs first
  const taskLogs = findLogFiles().filter(f => f.type === 'task');
  for (const { id: taskId } of taskLogs) {
    if (epicId) {
      const taskInfo = findTaskEpic(taskId);
      if (!taskInfo || taskInfo.epicId !== epicId) continue;
    }
    mergeTaskLog(taskId);
  }

  // Check for epic logs
  let epicLogs = findLogFiles().filter(f => f.type === 'epic');
  if (epicId) {
    epicLogs = epicLogs.filter(f => f.id === epicId);
  }

  const pendingEpics = epicLogs
    .filter(({ id }) => readLogFile(id)) // Has content
    .map(({ id }) => id);

  return {
    pending: pendingEpics.length > 0,
    epics: pendingEpics
  };
}

/**
 * Count TIP logs in task log file
 */
function countTaskTips(taskId) {
  const taskInfo = findTaskEpic(taskId);
  if (!taskInfo) return 0;

  // Check task's own log file
  const taskLog = readLogFile(taskId);
  if (!taskLog) return 0;

  const matches = taskLog.match(/\[TIP\]/g);
  return matches ? matches.length : 0;
}

/**
 * Add log entry to task file
 */
function logToTask(taskId, message, level = 'INFO') {
  const taskFile = findTaskFile(taskId);
  if (!taskFile) return false;

  const file = loadFile(taskFile);
  const author = 'agent';
  const levelPrefix = `[${level}] `;
  const fullMessage = levelPrefix + message;

  // Ensure body exists
  const body = file.body || '';
  const newBody = addLogEntry(body, fullMessage, author);
  saveFile(taskFile, file.data, newBody);
  return true;
}

/**
 * Get assignment file path for a task
 */
function assignmentPath(taskId) {
  const normalized = normalizeId(taskId);
  const dir = getAssignmentsDir();
  return path.join(dir, `${normalized}.yaml`);
}

// Context composition moved to ../lib/compose.js
// composeAgentContext is imported from there

/**
 * Get memory content for a task (Agent Context only)
 */
function getTaskMemory(taskId) {
  const taskFile = findTaskFile(taskId);
  if (!taskFile) {
    return { found: false, epicId: null, content: '' };
  }

  const file = loadFile(taskFile);
  const parent = file.data?.parent || '';

  // Extract epic ID from parent (e.g., "PRD-006 / E043" → "E043")
  const epicMatch = parent.match(/E(\d+)/i);
  if (!epicMatch) {
    return { found: false, epicId: null, content: '' };
  }

  const epicId = normalizeId(`E${epicMatch[1]}`);
  const memoryDir = getMemoryDir();
  const memoryFile = path.join(memoryDir, `${epicId}.md`);

  if (!fs.existsSync(memoryFile)) {
    return { found: false, epicId, content: '' };
  }

  const fullContent = fs.readFileSync(memoryFile, 'utf8');

  // Extract Agent Context section only
  const match = fullContent.match(/## Agent Context\s*([\s\S]*?)(?=\n## |$)/);
  if (!match || !match[1].trim()) {
    return { found: true, epicId, content: '' };
  }

  const context = match[1].replace(/<!--[\s\S]*?-->/g, '').trim();
  return { found: true, epicId, content: context };
}

/**
 * Get epic summary for prompt
 */
function getEpicSummary(epicId) {
  const epicFile = findEpicFile(epicId);
  if (!epicFile) {
    return null;
  }

  const file = loadFile(epicFile);
  const data = file.data || {};

  // Extract description section
  const contentMatch = file.body?.match(/## Description\s*([\s\S]*?)(?=\n## |$)/);
  const description = contentMatch ? contentMatch[1].trim() : '';

  // Extract Technical Notes section
  const techMatch = file.body?.match(/## Technical Notes\s*([\s\S]*?)(?=\n## |$)/);
  const techNotes = techMatch ? techMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '';

  return {
    id: epicId,
    title: data.title || '',
    parent: data.parent || '',
    description,
    techNotes,
    filePath: epicFile
  };
}

/**
 * Get task details for prompt
 */
function getTaskDetails(taskId) {
  const taskFile = findTaskFile(taskId);
  if (!taskFile) {
    return null;
  }

  const raw = fs.readFileSync(taskFile, 'utf8');
  return raw;
}

/**
 * Handle task claim (original behavior)
 */
function handleTaskClaim(taskId, options) {
  const filePath = assignmentPath(taskId);
  const operation = options.operation || 'task-start';

  // Pre-flight: Auto-cleanup orphan run files (crashed agents that didn't release)
  const orphans = findOrphanRuns();
  if (orphans.length > 0) {
    for (const o of orphans) {
      removeRunFile(o.taskId);
      console.error(`⚠ Cleaned up orphan run: ${o.taskId} (pid ${o.pid || '?'} crashed)`);
    }
  }

  let assignment;
  let tracked = false;
  let epicId = null;

  if (fs.existsSync(filePath)) {
    assignment = yaml.load(fs.readFileSync(filePath, 'utf8'));
    tracked = true;
    epicId = assignment.epicId;

    if (assignment.status === 'claimed') {
      console.error(`Assignment already claimed at ${assignment.claimed_at}`);
      process.exit(1);
    }
    if (assignment.status === 'complete') {
      console.error(`Assignment already complete at ${assignment.completed_at}`);
      process.exit(1);
    }
  } else {
    const taskFile = findTaskFile(taskId);
    if (!taskFile) {
      console.error(`Task not found: ${taskId}`);
      process.exit(1);
    }

    const file = loadFile(taskFile);
    const parent = file.data?.parent || '';
    const epicMatch = parent.match(/E(\d+)/i);
    epicId = epicMatch ? normalizeId(`E${epicMatch[1]}`) : null;

    assignment = { taskId, epicId, operation };
  }

  // Pre-flight check 2: Pending memory
  const memoryCheck = checkPendingMemory(epicId);
  if (memoryCheck.pending && !options.force) {
    console.error(`STOP: Pending memory consolidation required:`);
    for (const e of memoryCheck.epics) {
      console.error(`  ${e} - has unconsolidated logs`);
    }
    console.error(`\nRun: rudder memory:sync`);
    console.error(`Use --force to bypass (not recommended).`);
    process.exit(1);
  }

  // Build compiled prompt
  const promptParts = [];
  const debug = options.debug;

  // 1. Agent Contract
  const agentContext = composeAgentContext(operation, debug);
  if (agentContext.content) {
    if (debug) {
      promptParts.push(`<!-- section: Agent Contract (${agentContext.sources.length} fragments) -->\n${agentContext.content}`);
    } else {
      promptParts.push(agentContext.content);
    }
  }

  // 2. Memory (from epic)
  const memory = getTaskMemory(taskId);
  if (memory.content) {
    const config = loadPathsConfig();
    const memoryPath = `${config.paths.memory}/${memory.epicId}.md`;
    const header = debug
      ? `<!-- section: Memory, source: ${memoryPath} -->\n# Memory: ${memory.epicId}`
      : `# Memory: ${memory.epicId}`;
    promptParts.push(`${header}\n\n${memory.content}`);
  }

  // 3. Epic Context
  if (epicId) {
    const epic = getEpicSummary(epicId);
    if (epic) {
      const epicPath = epic.filePath || `epics/${epicId}-*.md`;
      const header = debug
        ? `<!-- section: Epic, source: ${epicPath} -->\n# Epic: ${epic.id}`
        : `# Epic: ${epic.id}`;
      let epicSection = `${header}\n\n**Title**: ${epic.title}\n**Parent**: ${epic.parent}`;
      if (epic.description) epicSection += `\n\n## Description\n\n${epic.description}`;
      if (epic.techNotes) epicSection += `\n\n## Technical Notes\n\n${epic.techNotes}`;
      promptParts.push(epicSection);
    }
  }

  // 4. Task (full file)
  const taskFile = findTaskFile(taskId);
  const taskContent = getTaskDetails(taskId);
  if (taskContent) {
    const header = debug
      ? `<!-- section: Task, source: ${taskFile} -->\n# Task: ${taskId}`
      : `# Task: ${taskId}`;
    promptParts.push(`${header}\n\n${taskContent}`);
  }

  const compiledPrompt = promptParts.join('\n\n---\n\n');

  if (tracked) {
    assignment.status = 'claimed';
    assignment.claimed_at = new Date().toISOString();
    fs.writeFileSync(filePath, yaml.dump(assignment));
  }

  createRunFile(taskId, operation);
  const approach = options.approach || operation;
  logToTask(taskId, `Starting: ${approach}`, 'INFO');

  if (options.json) {
    jsonOut({
      entityType: 'task',
      entityId: taskId,
      operation,
      sources: agentContext.sources,
      memoryEpic: memory.epicId,
      tracked,
      prompt: compiledPrompt
    });
    return;
  }

  if (options.sources) {
    console.log(`# Entity: ${taskId} (task)${tracked ? '' : ' (untracked)'}`);
    console.log(`# Operation: ${operation}`);
    console.log(`# Context sources: ${agentContext.sources.join(', ')}`);
    if (memory.epicId) console.log(`# Memory from: ${memory.epicId}`);
    console.log('\n');
  }

  console.log(compiledPrompt);
}

/**
 * Handle epic claim
 */
function handleEpicClaim(epicId, options) {
  const epicFile = findEpicFile(epicId);
  if (!epicFile) {
    console.error(`Epic not found: ${epicId}`);
    process.exit(1);
  }

  const file = loadFile(epicFile);
  const parent = file.data?.parent || '';
  const prdMatch = parent.match(/PRD-\d+/i);
  const prdId = prdMatch ? prdMatch[0] : null;

  // Default operation for epics
  const operation = options.operation || 'epic-breakdown';
  const debug = options.debug;
  const promptParts = [];

  // 1. Agent Contract
  const agentContext = composeAgentContext(operation, debug);
  if (agentContext.content) {
    if (debug) {
      promptParts.push(`<!-- section: Agent Contract (${agentContext.sources.length} fragments) -->\n${agentContext.content}`);
    } else {
      promptParts.push(agentContext.content);
    }
  }

  // 2. Memory (epic's own memory, full for breakdown/review)
  const memoryDir = getMemoryDir();
  const memoryFile = path.join(memoryDir, `${epicId}.md`);
  if (fs.existsSync(memoryFile)) {
    const memoryContent = fs.readFileSync(memoryFile, 'utf8').trim();
    if (memoryContent) {
      const header = debug
        ? `<!-- section: Memory, source: ${memoryFile} -->\n# Memory: ${epicId}`
        : `# Memory: ${epicId}`;
      promptParts.push(`${header}\n\n${memoryContent}`);
    }
  }

  // 3. PRD Context (if parent exists)
  if (prdId) {
    const prdFile = findPrdFile(prdId);
    if (prdFile) {
      const prdContent = fs.readFileSync(prdFile, 'utf8');
      const header = debug
        ? `<!-- section: PRD, source: ${prdFile} -->\n# PRD: ${prdId}`
        : `# PRD: ${prdId}`;
      promptParts.push(`${header}\n\n${prdContent}`);
    }
  }

  // 4. Epic (full file)
  const epicContent = getEpicDetails(epicId);
  if (epicContent) {
    const header = debug
      ? `<!-- section: Epic, source: ${epicFile} -->\n# Epic: ${epicId}`
      : `# Epic: ${epicId}`;
    promptParts.push(`${header}\n\n${epicContent}`);
  }

  const compiledPrompt = promptParts.join('\n\n---\n\n');

  if (options.json) {
    jsonOut({
      entityType: 'epic',
      entityId: epicId,
      operation,
      sources: agentContext.sources,
      prdId,
      prompt: compiledPrompt
    });
    return;
  }

  if (options.sources) {
    console.log(`# Entity: ${epicId} (epic)`);
    console.log(`# Operation: ${operation}`);
    console.log(`# Context sources: ${agentContext.sources.join(', ')}`);
    if (prdId) console.log(`# Parent PRD: ${prdId}`);
    console.log('\n');
  }

  console.log(compiledPrompt);
}

/**
 * Handle PRD claim
 */
function handlePrdClaim(prdId, options) {
  const prdFile = findPrdFile(prdId);
  if (!prdFile) {
    console.error(`PRD not found: ${prdId}`);
    process.exit(1);
  }

  // Default operation for PRDs
  const operation = options.operation || 'prd-breakdown';
  const debug = options.debug;
  const promptParts = [];

  // 1. Agent Contract
  const agentContext = composeAgentContext(operation, debug);
  if (agentContext.content) {
    if (debug) {
      promptParts.push(`<!-- section: Agent Contract (${agentContext.sources.length} fragments) -->\n${agentContext.content}`);
    } else {
      promptParts.push(agentContext.content);
    }
  }

  // 2. PRD (full file)
  const prdContent = getPrdDetails(prdId);
  if (prdContent) {
    const header = debug
      ? `<!-- section: PRD, source: ${prdFile} -->\n# PRD: ${prdId}`
      : `# PRD: ${prdId}`;
    promptParts.push(`${header}\n\n${prdContent}`);
  }

  const compiledPrompt = promptParts.join('\n\n---\n\n');

  if (options.json) {
    jsonOut({
      entityType: 'prd',
      entityId: prdId,
      operation,
      sources: agentContext.sources,
      prompt: compiledPrompt
    });
    return;
  }

  if (options.sources) {
    console.log(`# Entity: ${prdId} (prd)`);
    console.log(`# Operation: ${operation}`);
    console.log(`# Context sources: ${agentContext.sources.join(', ')}`);
    console.log('\n');
  }

  console.log(compiledPrompt);
}

/**
 * Register assignment commands
 */
export function registerAssignCommands(program) {
  const assign = program.command('assign')
    .description('Assignment operations (skill → agent prompt)');

  // assign:create TNNN --operation <op>
  withModifies(assign.command('create <task-id>'), ['task'])
    .description('Create an assignment for a task')
    .requiredOption('--operation <op>', 'Operation type (task-start, etc.)')
    .option('--path', 'Show file path (discouraged)')
    .option('--json', 'JSON output')
    .action((taskId: string, options: { operation: string; path?: boolean; json?: boolean }) => {
      const normalized = normalizeId(taskId);

      // Validate task exists
      const taskFile = findTaskFile(normalized);
      if (!taskFile) {
        console.error(`Task not found: ${normalized}`);
        process.exit(1);
      }

      const file = loadFile(taskFile);
      const parent = file.data?.parent || '';
      const epicMatch = parent.match(/E(\d+)/i);
      const epicId = epicMatch ? normalizeId(`E${epicMatch[1]}`) : null;

      const filePath = assignmentPath(normalized);

      // Check if assignment already exists
      if (fs.existsSync(filePath)) {
        const existing = yaml.load(fs.readFileSync(filePath, 'utf8'));
        if (existing.status !== 'complete') {
          console.error(`Assignment already exists for ${normalized} (status: ${existing.status})`);
          process.exit(1);
        }
      }

      const assignment = {
        taskId: normalized,
        epicId,
        operation: options.operation,
        status: 'pending',
        created_at: new Date().toISOString(),
        claimed_at: null,
        completed_at: null,
        projectHash: computeProjectHash()
      };

      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, yaml.dump(assignment));

      if (options.json) {
        const output: any = { ...assignment };
        if (options.path) output.file = filePath;
        jsonOut(output);
      } else {
        console.log(`Created assignment: ${normalized}`);
        console.log(`  Operation: ${options.operation}`);
        if (options.path) console.log(`  Path: ${filePath}`);
      }
    });

  // assign:claim <entity-id> - unified context for tasks, epics, PRDs
  withModifies(assign.command('claim <entity-id>'), ['task'])
    .description('Get compiled prompt for any entity (task, epic, or PRD)')
    .requiredOption('--role <role>', 'Role context (required): only "agent" allowed')
    .option('--operation <op>', 'Operation type (auto-detected if not specified)')
    .option('--approach <text>', 'Approach description for auto-log (tasks only)')
    .option('--force', 'Force claim even with orphan runs or pending memory')
    .option('--sources', 'Show fragment sources used')
    .option('--debug', 'Add source comments to each section')
    .option('--json', 'JSON output')
    .action((entityId: string, options: {
      role: string;
      operation?: string;
      approach?: string;
      force?: boolean;
      sources?: boolean;
      debug?: boolean;
      json?: boolean;
    }) => {
      // Role enforcement: only agents claim - skill/coordinator MUST spawn an agent
      if (options.role !== 'agent') {
        console.error(`ERROR: assign:claim requires --role agent`);
        console.error(`\nReceived: --role ${options.role}`);
        console.error(`\nSkill/coordinator MUST spawn an inline agent (Task tool) that calls:`);
        console.error(`  assign:claim ${entityId} --role agent`);
        console.error(`\nDo NOT call assign:claim directly - it pollutes your context with agent prompts.`);
        process.exit(1);
      }

      const entity = detectEntityType(entityId);

      if (entity.type === 'unknown') {
        console.error(`Unknown entity type: ${entityId}`);
        console.error(`Expected: TNNN (task), ENNN (epic), or PRD-NNN`);
        process.exit(1);
      }

      // Route to appropriate handler
      if (entity.type === 'task') {
        handleTaskClaim(entity.id, options);
      } else if (entity.type === 'epic') {
        handleEpicClaim(entity.id, options);
      } else if (entity.type === 'prd') {
        handlePrdClaim(entity.id, options);
      }
    });

  // assign:release TNNN
  withModifies(assign.command('release <task-id>'), ['task'])
    .description('Release assignment (agent finished)')
    .option('--status <status>', 'Task completion status (Done or Blocked)', 'Done')
    .option('--json', 'JSON output')
    .action((taskId: string, options: { status: string; json?: boolean }) => {
      const normalized = normalizeId(taskId);

      // Check if run file exists
      if (!isRunning(normalized)) {
        console.error(`No active run for ${normalized}`);
        console.error(`Use assign:claim first to start.`);
        process.exit(1);
      }

      // Check for TIP logs (warn if none)
      const tipCount = countTaskTips(normalized);
      if (tipCount === 0) {
        console.error(`⚠ Warning: No TIP logs found for ${normalized}`);
        console.error(`  Agents should log at least 1 tip during work.`);
        console.error(`  Use: rudder task:log ${normalized} "insight" --tip`);
        // Continue anyway - just a warning
      }

      // Auto-log completion
      logToTask(normalized, 'Completed', 'INFO');

      // Update task status
      const taskFile = findTaskFile(normalized);
      if (taskFile) {
        const file = loadFile(taskFile);
        const newStatus = options.status === 'Blocked' ? 'Blocked' : 'Done';
        file.data.status = newStatus;
        if (newStatus === 'Done') {
          file.data.done_at = new Date().toISOString();
        }
        saveFile(taskFile, file.data, file.body || '');
      }

      // Remove run file
      removeRunFile(normalized);

      // Update assignment file if tracked
      const assignPath = assignmentPath(normalized);
      if (fs.existsSync(assignPath)) {
        const assignment = yaml.load(fs.readFileSync(assignPath, 'utf8'));
        assignment.status = 'complete';
        assignment.completed_at = new Date().toISOString();
        assignment.success = options.status !== 'Blocked';
        fs.writeFileSync(assignPath, yaml.dump(assignment));
      }

      if (options.json) {
        jsonOut({
          taskId: normalized,
          status: options.status,
          tipCount,
          released: true
        });
        return;
      }

      console.log(`✓ Released ${normalized} (${options.status})`);
      if (tipCount === 0) {
        console.log(`  ⚠ No TIP logs - consider adding insights for next agent`);
      } else {
        console.log(`  ${tipCount} TIP log(s) recorded`);
      }
    });

  // assign:show TNNN
  assign.command('show <task-id>')
    .action((taskId: string, options: { json?: boolean }) => {
      const normalized = normalizeId(taskId);
      const filePath = assignmentPath(normalized);

      if (!fs.existsSync(filePath)) {
        console.error(`No assignment found for ${normalized}`);
        process.exit(1);
      }

      const assignment = yaml.load(fs.readFileSync(filePath, 'utf8'));

      if (options.json) {
        jsonOut(assignment);
        return;
      }

      console.log(`Assignment: ${normalized}`);
      console.log(`  Status: ${assignment.status}`);
      console.log(`  Operation: ${assignment.operation}`);
      console.log(`  Epic: ${assignment.epicId || 'none'}`);
      console.log(`  Created: ${assignment.created_at}`);
      if (assignment.claimed_at) {
        console.log(`  Claimed: ${assignment.claimed_at}`);
      }
      if (assignment.completed_at) {
        console.log(`  Completed: ${assignment.completed_at}`);
      }
    });

  // assign:list
  assign.command('list')
    .description('List all assignments')
    .option('--status <status>', 'Filter by status (pending, claimed, complete)')
    .option('--json', 'JSON output')
    .action((options: { status?: string; json?: boolean }) => {
      const dir = getAssignmentsDir();
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));

      const projectHash = computeProjectHash();
      const assignments = [];

      for (const file of files) {
        const content = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8'));

        // Only show assignments for current project
        if (content.projectHash && content.projectHash !== projectHash) {
          continue;
        }

        // Filter by status if specified
        if (options.status && content.status !== options.status) {
          continue;
        }

        assignments.push(content);
      }

      if (options.json) {
        jsonOut(assignments);
        return;
      }

      if (assignments.length === 0) {
        console.log('No assignments found');
        return;
      }

      console.log(`Assignments (${assignments.length}):\n`);
      for (const a of assignments) {
        const age = a.claimed_at
          ? `claimed ${timeSince(new Date(a.claimed_at))}`
          : `created ${timeSince(new Date(a.created_at))}`;
        console.log(`  ${a.taskId}  ${a.status.padEnd(8)}  ${a.operation.padEnd(12)}  ${age}`);
      }
    });

  // assign:complete TNNN
  withModifies(assign.command('complete <task-id>'), ['task'])
    .description('Mark an assignment as complete')
    .option('--success', 'Mark as successful completion')
    .option('--failure', 'Mark as failed completion')
    .option('--json', 'JSON output')
    .action((taskId: string, options: { success?: boolean; failure?: boolean; json?: boolean }) => {
      const normalized = normalizeId(taskId);
      const filePath = assignmentPath(normalized);

      if (!fs.existsSync(filePath)) {
        console.error(`No assignment found for ${normalized}`);
        process.exit(1);
      }

      const assignment = yaml.load(fs.readFileSync(filePath, 'utf8'));

      if (assignment.status === 'complete') {
        console.error(`Assignment already complete at ${assignment.completed_at}`);
        process.exit(1);
      }

      assignment.status = 'complete';
      assignment.completed_at = new Date().toISOString();
      assignment.success = options.failure ? false : true;

      fs.writeFileSync(filePath, yaml.dump(assignment));

      if (options.json) {
        jsonOut(assignment);
        return;
      }

      const result = assignment.success ? 'successfully' : 'with failure';
      console.log(`Assignment ${normalized} completed ${result}`);
    });

  // assign:delete TNNN
  withModifies(assign.command('delete <task-id>'), ['task'])
    .description('Delete an assignment')
    .option('--force', 'Force delete even if claimed')
    .option('--json', 'JSON output')
    .action((taskId: string, options: { force?: boolean; json?: boolean }) => {
      const normalized = normalizeId(taskId);
      const filePath = assignmentPath(normalized);

      if (!fs.existsSync(filePath)) {
        console.error(`No assignment found for ${normalized}`);
        process.exit(1);
      }

      const assignment = yaml.load(fs.readFileSync(filePath, 'utf8'));

      if (assignment.status === 'claimed' && !options.force) {
        console.error(`Assignment is claimed. Use --force to delete.`);
        process.exit(1);
      }

      fs.unlinkSync(filePath);

      if (options.json) {
        jsonOut({ deleted: normalized });
        return;
      }

      console.log(`Deleted assignment: ${normalized}`);
    });

  // Add dynamic help
  addDynamicHelp(assign);
}

/**
 * Time since helper
 */
function timeSince(date: Date) {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
