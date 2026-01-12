/**
 * Common error helpers for DRY validation
 */
import { loadFile } from './core.js';
import { findTaskFile, findEpicFile, findPrdFile } from './entities.js';
import { loadState } from './state.js';
import { normalizeId } from './normalize.js';

type JsonOption = { json?: boolean };

interface LoadedDoc {
  data: Record<string, unknown>;
  body: string;
}

interface RequireResult {
  id: string;
  file: string;
  data: Record<string, unknown>;
  body: string;
}

interface AgentResult {
  taskId: string;
  agent: Record<string, unknown>;
  state: { agents?: Record<string, unknown> } & Record<string, unknown>;
}

/**
 * Require a task exists, exit if not found
 * @param {string} id - Task ID
 * @param {object} [options] - Options
 * @param {boolean} [options.json] - JSON output mode
 * @returns {{ id: string, file: string, data: object, body: string }}
 */
export function requireTask(id: string, options: JsonOption = {}): RequireResult {
  const normalized = normalizeId(id) ?? '';
  const file = findTaskFile(normalized);

  if (!file) {
    if (options.json) {
      console.log(JSON.stringify({ error: `Task not found: ${normalized}` }));
    } else {
      console.error(`Task not found: ${normalized}`);
    }
    process.exit(1);
  }

  const loaded = loadFile(file) as LoadedDoc | undefined;
  if (!loaded) {
    if (options.json) {
      console.log(JSON.stringify({ error: `Could not load task: ${normalized}` }));
    } else {
      console.error(`Could not load task: ${normalized}`);
    }
    process.exit(1);
    throw new Error('Exiting (task not loaded)'); // satisfy TS control flow
  }

  return { id: normalized, file, data: loaded.data, body: loaded.body };
}

/**
 * Require an epic exists, exit if not found
 * @param {string} id - Epic ID
 * @param {object} [options] - Options
 * @param {boolean} [options.json] - JSON output mode
 * @returns {{ id: string, file: string, data: object, body: string }}
 */
export function requireEpic(id: string, options: JsonOption = {}): RequireResult {
  const normalized = normalizeId(id) ?? '';
  const file = findEpicFile(normalized);

  if (!file) {
    if (options.json) {
      console.log(JSON.stringify({ error: `Epic not found: ${normalized}` }));
    } else {
      console.error(`Epic not found: ${normalized}`);
    }
    process.exit(1);
  }

  const loaded = loadFile(file) as LoadedDoc | undefined;
  if (!loaded) {
    if (options.json) {
      console.log(JSON.stringify({ error: `Could not load epic: ${normalized}` }));
    } else {
      console.error(`Could not load epic: ${normalized}`);
    }
    process.exit(1);
    throw new Error('Exiting (epic not loaded)');
  }

  return { id: normalized, file, data: loaded.data, body: loaded.body };
}

/**
 * Require a PRD exists, exit if not found
 * @param {string} id - PRD ID
 * @param {object} [options] - Options
 * @param {boolean} [options.json] - JSON output mode
 * @returns {{ id: string, file: string, data: object, body: string }}
 */
export function requirePrd(id: string, options: JsonOption = {}): RequireResult {
  const normalized = normalizeId(id) ?? '';
  const file = findPrdFile(normalized);

  if (!file) {
    if (options.json) {
      console.log(JSON.stringify({ error: `PRD not found: ${normalized}` }));
    } else {
      console.error(`PRD not found: ${normalized}`);
    }
    process.exit(1);
  }

  const loaded = loadFile(file) as LoadedDoc | undefined;
  if (!loaded) {
    if (options.json) {
      console.log(JSON.stringify({ error: `Could not load PRD: ${normalized}` }));
    } else {
      console.error(`Could not load PRD: ${normalized}`);
    }
    process.exit(1);
    throw new Error('Exiting (PRD not loaded)');
  }

  return { id: normalized, file, data: loaded.data, body: loaded.body };
}

/**
 * Require an agent exists in state, exit if not found
 * @param {string} taskId - Task ID
 * @param {object} [options] - Options
 * @param {boolean} [options.json] - JSON output mode
 * @returns {{ taskId: string, agent: object, state: object }}
 */
export function requireAgent(taskId: string, options: JsonOption = {}): AgentResult {
  const normalized = normalizeId(taskId) ?? '';
  const state = loadState();
  const agent = state.agents?.[normalized];

  if (!agent) {
    if (options.json) {
      console.log(JSON.stringify({ error: `No agent found for task: ${normalized}` }));
    } else {
      console.error(`No agent found for task: ${normalized}`);
    }
    process.exit(1);
    throw new Error('Exiting (agent not found)');
  }

  return { taskId: normalized, agent, state };
}

/**
 * Require artifact exists (task, epic, or PRD)
 * @param {string} id - Artifact ID (T001, E001, PRD-001)
 * @param {object} [options] - Options
 * @returns {{ id: string, type: string, file: string, data: object, body: string }}
 */
export function requireArtifact(id: string, options: JsonOption = {}): (RequireResult & { type: string }) {
  const normalized = normalizeId(id) ?? '';

  if (normalized.startsWith('T')) {
    const result = requireTask(normalized, options);
    return { ...result, type: 'task' };
  } else if (normalized.startsWith('E')) {
    const result = requireEpic(normalized, options);
    return { ...result, type: 'epic' };
  } else if (normalized.startsWith('PRD-')) {
    const result = requirePrd(normalized, options);
    return { ...result, type: 'prd' };
  }

  if (options.json) {
    console.log(JSON.stringify({ error: `Unknown artifact type: ${normalized}` }));
  } else {
    console.error(`Unknown artifact type: ${normalized}`);
  }
  process.exit(1);
  throw new Error('Exiting (unknown artifact)');
}
