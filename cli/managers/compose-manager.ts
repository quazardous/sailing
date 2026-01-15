/**
 * Compose Manager
 *
 * Business logic for context/prompt composition.
 * Provides config-aware wrappers for lib/compose.ts functions.
 */
import fs from 'fs';
import { getAgentConfig, getPrompting, getPathsInfo, loadFile } from './core-manager.js';
// Note: fs is still used in buildPromptLegacy
import { getTask, getTaskEpic, getEpicPrd, getEpic, getPrd, getMemoryFile } from './artefacts-manager.js';
import { renderTemplate } from './template-manager.js';
import { getAgentMemory } from '../lib/memory-section.js';
import {
  resolveInject,
  getSetFragments,
  resolveFragments,
  renderOrchestration,
  loadWorkflowsConfigFrom,
  loadFragmentFrom,
  loadProjectFileFrom,
  ComposeContextOptions,
  BuildPromptOptions
} from '../lib/compose.js';

// Re-export pure functions from lib
export {
  resolveInject,
  getSetFragments,
  resolveFragments,
  renderOrchestration,
  loadWorkflowsConfigFrom,
  loadFragmentFrom,
  loadProjectFileFrom
};

// Re-export types
export type { ComposeContextOptions, BuildPromptOptions, ResolvedFragments } from '../lib/compose.js';

// ============================================================================
// Types
// ============================================================================

export interface ComposeOptions {
  operation: string;
  role?: string;
  mode?: 'inline' | 'subprocess';
  debug?: boolean;
  includeHeader?: boolean;
  includeWorkflow?: boolean;
  includeProjectFiles?: boolean;
}

export interface ComposeResult {
  content: string;
  sources: string[];
  role: string;
  operation: string;
}

export interface SpawnPromptResult {
  prompt: string;
  taskId: string;
  epicId: string;
  prdId: string;
}

// ============================================================================
// Config Helpers
// ============================================================================

/**
 * Get execution mode from config
 */
export function getExecMode(): 'inline' | 'subprocess' {
  const config = getAgentConfig();
  return config.use_subprocess ? 'subprocess' : 'inline';
}

/**
 * Get agent config values needed for compose
 */
function getComposeConfig() {
  const config = getAgentConfig();
  return {
    useWorktrees: config.use_worktrees ?? true,
    useSubprocess: config.use_subprocess ?? false,
    sandbox: config.sandbox ?? false
  };
}

// ============================================================================
// Config-aware wrappers for lib I/O functions
// ============================================================================

/**
 * Load unified workflows.yaml configuration (uses config for path)
 */
export function loadWorkflowsConfig() {
  return loadWorkflowsConfigFrom(getPrompting());
}

/**
 * Load a prompting fragment (uses config for path)
 * @param fragmentPath - Path relative to prompting/ (without .md)
 */
export function loadFragment(fragmentPath: string): string | null {
  return loadFragmentFrom(getPrompting(), fragmentPath);
}

/**
 * Load project-centric file if it exists (uses config for paths)
 * @param key - Path key from getPathsInfo()
 */
export function loadProjectFile(key: string): { content: string; source: string } | null {
  const paths = getPathsInfo();
  const info = paths[key];
  if (!info) return null;
  return loadProjectFileFrom(info.absolute, key);
}

// ============================================================================
// Core Composition Functions
// ============================================================================

/**
 * Core context composition function
 */
function composeContextCore(options: ComposeContextOptions): ComposeResult | null {
  const {
    operation,
    role = null,
    mode,
    useWorktrees,
    debug = false,
    includeHeader = true,
    includeWorkflow = true,
    includeProjectFiles = true
  } = options;

  const config = loadWorkflowsConfig();
  if (!config) {
    return null;
  }

  const resolved = resolveFragments(config, operation, role, mode, useWorktrees);
  if (!resolved) {
    return null;
  }

  const { fragments, role: resolvedRole, roleDef, exclude, injectFragments, injectFiles } = resolved;
  const parts: string[] = [];
  const sources: string[] = [];

  // 1. MODE HEADER: Inject execution mode info at the very beginning
  if (includeHeader) {
    const modeHeader = `<!-- mode: ${mode} | worktrees: ${useWorktrees ? 'enabled' : 'disabled'} -->`;
    parts.push(modeHeader);
    sources.push('mode-header');
  }

  // 2. Add base fragments (excluding excluded ones)
  for (const fragmentPath of fragments) {
    // Skip excluded fragments
    if (exclude.includes(fragmentPath)) continue;

    const content = loadFragment(fragmentPath);
    if (content) {
      if (debug) {
        parts.push(`<!-- source: prompting/${fragmentPath}.md -->\n${content}`);
      } else {
        parts.push(content);
      }
      sources.push(fragmentPath);
    } else if (debug) {
      console.error(`Warning: Fragment not found: ${fragmentPath}`);
    }
  }

  // 3. Add inject fragments (e.g., agent/mcp-rudder for subprocess)
  for (const fragmentPath of injectFragments) {
    if (exclude.includes(fragmentPath)) continue;

    const content = loadFragment(fragmentPath);
    if (content) {
      if (debug) {
        parts.push(`<!-- source: prompting/${fragmentPath}.md (injected) -->\n${content}`);
      } else {
        parts.push(content);
      }
      sources.push(fragmentPath);
    } else if (debug) {
      console.error(`Warning: Inject fragment not found: ${fragmentPath}`);
    }
  }

  // 4. Inject orchestration workflow if role.workflow is true
  if (includeWorkflow && roleDef.workflow) {
    const workflow = renderOrchestration(config, operation, mode, resolvedRole);
    if (workflow) {
      parts.push(workflow);
      sources.push(`orchestration:${operation}:${mode}`);
    }
  }

  // 5. Load project files (from inject dimensions)
  if (includeProjectFiles && injectFiles) {
    for (const key of injectFiles) {
      const projectFile = loadProjectFile(key);
      if (projectFile) {
        parts.push(projectFile.content);
        sources.push(projectFile.source);
      }
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return {
    content: parts.join('\n\n---\n\n'),
    sources,
    role: resolvedRole,
    operation
  };
}

/**
 * Core prompt builder for agent spawn
 */
function buildPromptCore(taskId: string, options: BuildPromptOptions): SpawnPromptResult | null {
  const { useWorktree, sandbox } = options;

  // Get task from index
  const taskEntry = getTask(taskId);
  if (!taskEntry) {
    return null;
  }

  // Load full task content (including body)
  const taskFile = loadFile(taskEntry.file);
  if (!taskFile) {
    return null;
  }

  // Get epic and PRD from index
  const epic = getTaskEpic(taskId);
  const epicId = epic?.epicId || 'unknown';
  const epicTitle = epic?.epicId ? getEpic(epic.epicId)?.data?.title || null : null;
  const prd = epic ? getEpicPrd(epic.epicId) : null;
  const prdId = prd?.prdId || 'unknown';
  const prdTitle = prdId !== 'unknown' ? getPrd(prdId)?.data?.title || null : null;

  // Load agent-relevant memory (filtered sections only)
  const memory = getAgentMemory(epicId);

  // Filter task body: remove Log section and HTML comment lines
  const taskBody = taskFile.body
    .split(/^(?=## )/m)
    .filter((section: string) => !section.startsWith('## Log'))
    .join('')
    .split('\n')
    .filter((line: string) => !line.trim().startsWith('<!--'))  // Remove comment lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')       // Collapse multiple blank lines
    .trim();

  // Try prompting_v2 template first
  const prompt = renderTemplate('task-start', {
    taskId,
    epicId,
    epicTitle,
    prdId,
    prdTitle,
    mode: useWorktree ? 'worktree' : 'inline',
    sandbox,
    role: 'agent',
    taskBody,
    memory
  });

  if (prompt) {
    return { prompt, taskId, epicId, prdId };
  }

  // Fallback to legacy (will be removed once v2 is stable)
  console.error('Warning: prompting_v2 template not found, using legacy');
  return buildPromptLegacy(taskId, useWorktree);
}

/**
 * Legacy prompt builder (deprecated, kept for fallback)
 */
function buildPromptLegacy(taskId: string, useWorktree: boolean): SpawnPromptResult | null {
  const taskEntry = getTask(taskId);
  if (!taskEntry) return null;

  const taskFile = loadFile(taskEntry.file);
  if (!taskFile) return null;

  const epic = getTaskEpic(taskId);
  const epicId = epic?.epicId || 'unknown';
  const prd = epic ? getEpicPrd(epic.epicId) : null;
  const prdId = prd?.prdId || 'unknown';

  let memoryContent = '';
  const memoryEntry = getMemoryFile(epicId);
  if (memoryEntry && fs.existsSync(memoryEntry.file)) {
    memoryContent = fs.readFileSync(memoryEntry.file, 'utf8').trim();
  }

  const prompt = `# Agent Mission: ${taskId}

You are an autonomous agent assigned to task ${taskId}.
Epic: ${epicId}, PRD: ${prdId}

${useWorktree ? '**Worktree mode**: Commit before exiting.' : '**Inline mode**: No commit needed.'}

---

# Task Deliverables

${taskFile.body.trim()}

---

${memoryContent ? `# Epic Memory\n\n${memoryContent}\n\n---\n\n` : ''}`;

  return { prompt, taskId, epicId, prdId };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Compose context for an operation
 * Main entry point for context composition
 */
export function composeContext(options: ComposeOptions): ComposeResult | null {
  const config = getComposeConfig();
  const mode = options.mode || (config.useSubprocess ? 'subprocess' : 'inline');

  return composeContextCore({
    ...options,
    mode,
    useWorktrees: config.useWorktrees
  });
}

/**
 * Compose agent context for agent:spawn
 * Convenience wrapper with agent role preset
 */
export function composeAgentContext(operation: string, debug = false): ComposeResult {
  const result = composeContext({
    operation,
    role: 'agent',
    debug
  });

  return result || { content: '', sources: [], role: 'agent', operation };
}

/**
 * Build complete agent spawn prompt for a task
 */
export function buildAgentSpawnPrompt(
  taskId: string,
  options: { useWorktree?: boolean } = {}
): SpawnPromptResult | null {
  const config = getComposeConfig();
  const useWorktree = options.useWorktree ?? config.useWorktrees;

  return buildPromptCore(taskId, {
    useWorktree,
    sandbox: config.sandbox
  });
}
