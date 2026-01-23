/**
 * Assignment command helpers and types
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { jsonOut, getMemoryDir, loadFile, saveFile, loadPathsConfig, getRunsDir, getAssignmentsDir, ensureDir } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { getTask, getEpic, getPrd } from '../../managers/artefacts-manager.js';
import { checkPendingMemory } from '../../managers/memory-manager.js';
import { addLogEntry } from '../../lib/update.js';
import { composeAgentContext } from '../../managers/compose-manager.js';
import { checkGuards, handleGuardResult } from '../../lib/guards.js';

// Types
export interface AssignmentData {
  taskId: string;
  epicId: string | null;
  operation: string;
  status?: string;
  created_at?: string;
  claimed_at?: string;
  completed_at?: string;
  success?: boolean;
  projectHash?: string;
}

export interface RunFileData {
  taskId: string;
  operation: string;
  started_at: string;
  pid?: number;
  file: string;
}

export interface EpicSummary {
  id: string;
  title: string;
  parent: string;
  description: string;
  techNotes: string;
  filePath: string;
}

export interface TaskClaimOptions {
  operation?: string;
  approach?: string;
  force?: boolean;
  sources?: boolean;
  debug?: boolean;
  json?: boolean;
}

export interface EpicClaimOptions {
  operation?: string;
  sources?: boolean;
  debug?: boolean;
  json?: boolean;
}

export interface PrdClaimOptions {
  operation?: string;
  sources?: boolean;
  debug?: boolean;
  json?: boolean;
}

/**
 * Find task file by ID (via index.ts)
 */
export function findTaskFile(taskId: string): string | null {
  return getTask(taskId)?.file || null;
}

/**
 * Find epic file by ID (via index.ts)
 */
export function findEpicFile(epicId: string): string | null {
  return getEpic(epicId)?.file || null;
}

/**
 * Find PRD file by ID (via index.ts)
 */
export function findPrdFile(prdId: string): string | null {
  return getPrd(prdId)?.file || null;
}

/**
 * Detect entity type from ID
 */
export function detectEntityType(id: string): { type: 'task' | 'epic' | 'prd' | 'unknown'; id: string } {
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
export function getPrdDetails(prdId: string): string | null {
  const prdFile = findPrdFile(prdId);
  if (!prdFile) return null;

  const raw = fs.readFileSync(prdFile, 'utf8');
  return raw;
}

/**
 * Get epic details for prompt (full file)
 */
export function getEpicDetails(epicId: string): string | null {
  const epicFile = findEpicFile(epicId);
  if (!epicFile) return null;

  const raw = fs.readFileSync(epicFile, 'utf8');
  return raw;
}

/**
 * Get run file path for a task
 */
export function runFilePath(taskId: string): string {
  const dir = getRunsDir();
  return path.join(dir, `${taskId}.run`);
}

/**
 * Check if run file exists (agent is running)
 */
export function isRunning(taskId: string): boolean {
  return fs.existsSync(runFilePath(taskId));
}

/**
 * Create run file (mark agent as running)
 */
export function createRunFile(taskId: string, operation: string) {
  const filePath = runFilePath(taskId);
  ensureDir(path.dirname(filePath));
  const data: {
    taskId: string;
    operation: string;
    started_at: string;
    pid: number;
  } = {
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
export function removeRunFile(taskId: string): boolean {
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
export function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);  // Signal 0 = check if process exists
    return true;
  } catch {
    return false;  // ESRCH = no such process
  }
}

/**
 * List orphan run files (runs where the agent process is dead)
 * Active agents (PID alive) are NOT orphans
 */
export function findOrphanRuns(): RunFileData[] {
  const dir = getRunsDir();
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.run'))
    .map(f => {
      const content = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')) as { taskId: string; operation: string; started_at: string; pid?: number };
      return { taskId: content.taskId, file: f, operation: content.operation, started_at: content.started_at, pid: content.pid } as RunFileData;
    })
    .filter(run => !isPidAlive(run.pid));  // Only orphans = dead PIDs
}

/**
 * Add log entry to task file
 */
export function logToTask(taskId: string, message: string, level = 'INFO'): boolean {
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
export function assignmentPath(taskId: string): string {
  const normalized = normalizeId(taskId);
  const dir = getAssignmentsDir();
  return path.join(dir, `${normalized}.yaml`);
}

/**
 * Get memory content for a task (Agent Context only)
 */
export function getTaskMemory(taskId: string): { found: boolean; epicId: string | null; content: string } {
  const taskFile = findTaskFile(taskId);
  if (!taskFile) {
    return { found: false, epicId: null, content: '' };
  }

  const file = loadFile(taskFile);
  const parent = (file.data?.parent as string | undefined) || '';

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
export function getEpicSummary(epicId: string): EpicSummary | null {
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
    title: (data.title as string | undefined) || '',
    parent: (data.parent as string | undefined) || '',
    description,
    techNotes,
    filePath: epicFile
  };
}

/**
 * Get task details for prompt
 */
export function getTaskDetails(taskId: string): string | null {
  const taskFile = findTaskFile(taskId);
  if (!taskFile) {
    return null;
  }

  const raw = fs.readFileSync(taskFile, 'utf8');
  return raw;
}

/**
 * Time since helper
 */
export function timeSince(date: Date) {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Handle task claim (original behavior)
 */
export async function handleTaskClaim(taskId: string, options: TaskClaimOptions) {
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

  let assignment: AssignmentData;
  let tracked = false;
  let epicId: string | null = null;

  if (fs.existsSync(filePath)) {
    assignment = yaml.load(fs.readFileSync(filePath, 'utf8')) as AssignmentData;
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
    const parent = (file.data?.parent as string | undefined) || '';
    const epicMatch = parent.match(/E(\d+)/i);
    epicId = epicMatch ? normalizeId(`E${epicMatch[1]}`) : null;

    assignment = { taskId, epicId, operation };
  }

  // Pre-flight check 2: Pending memory (via guards)
  if (!options.force) {
    const memoryCheck = checkPendingMemory(epicId);
    const guardResult = await checkGuards('assign:claim', {
      taskId,
      pendingMemory: memoryCheck.pending,
      pendingEpics: memoryCheck.epics
    });
    handleGuardResult(guardResult);
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
    const config = loadPathsConfig() as { paths: { memory: string } };
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
export function handleEpicClaim(epicId: string, options: EpicClaimOptions) {
  const epicFile = findEpicFile(epicId);
  if (!epicFile) {
    console.error(`Epic not found: ${epicId}`);
    process.exit(1);
  }

  const file = loadFile(epicFile);
  const parent = (file.data?.parent as string | undefined) || '';
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
export function handlePrdClaim(prdId: string, options: PrdClaimOptions) {
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
