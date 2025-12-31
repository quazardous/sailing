/**
 * Assignment commands for rudder CLI
 * Formalizes skill → agent prompt transmission
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { jsonOut, getPrompting, getMemoryDir, loadFile, getPrdsDir } from '../lib/core.js';
import { resolvePlaceholders, ensureDir, computeProjectHash } from '../lib/paths.js';
import { normalizeId } from '../lib/normalize.js';
import { addDynamicHelp } from '../lib/help.js';

/**
 * Find task file by ID
 */
function findTaskFile(taskId) {
  const prdsDir = getPrdsDir();
  if (!fs.existsSync(prdsDir)) return null;

  for (const prdDir of fs.readdirSync(prdsDir)) {
    const tasksDir = path.join(prdsDir, prdDir, 'tasks');
    if (!fs.existsSync(tasksDir)) continue;

    for (const file of fs.readdirSync(tasksDir)) {
      if (file.startsWith(taskId + '-') && file.endsWith('.md')) {
        return path.join(tasksDir, file);
      }
    }
  }
  return null;
}

/**
 * Find epic file by ID
 */
function findEpicFile(epicId) {
  const prdsDir = getPrdsDir();
  if (!fs.existsSync(prdsDir)) return null;

  for (const prdDir of fs.readdirSync(prdsDir)) {
    const epicsDir = path.join(prdsDir, prdDir, 'epics');
    if (!fs.existsSync(epicsDir)) continue;

    for (const file of fs.readdirSync(epicsDir)) {
      if (file.startsWith(epicId + '-') && file.endsWith('.md')) {
        return path.join(epicsDir, file);
      }
    }
  }
  return null;
}

/**
 * Get assignments directory path
 */
function getAssignmentsDir() {
  const dirPath = resolvePlaceholders('%haven%/assignments');
  return ensureDir(dirPath);
}

/**
 * Get assignment file path for a task
 */
function assignmentPath(taskId) {
  const normalized = normalizeId(taskId);
  const dir = getAssignmentsDir();
  return path.join(dir, `${normalized}.yaml`);
}

/**
 * Load contexts.yaml configuration
 */
function loadContextsConfig() {
  const promptingDir = getPrompting();
  const configPath = path.join(promptingDir, 'contexts.yaml');

  if (!fs.existsSync(configPath)) {
    return null;
  }

  const content = fs.readFileSync(configPath, 'utf8');
  return yaml.load(content);
}

/**
 * Load a fragment file
 */
function loadFragment(fragmentPath) {
  const promptingDir = getPrompting();
  const fullPath = path.join(promptingDir, `${fragmentPath}.md`);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  return fs.readFileSync(fullPath, 'utf8').trim();
}

/**
 * Compose context from fragments for an operation
 * @param {string} operation - Operation type (task-start, etc.)
 * @param {boolean} debug - Add source comments to each fragment
 */
function composeAgentContext(operation, debug = false) {
  const config = loadContextsConfig();
  if (!config || !config.agent) {
    return { content: '', sources: [] };
  }

  const fragments = config.agent[operation] || config.agent['default'] || [];
  const parts = [];
  const sources = [];

  for (const fragmentPath of fragments) {
    const content = loadFragment(fragmentPath);
    if (content) {
      if (debug) {
        parts.push(`<!-- source: prompting/${fragmentPath}.md -->\n${content}`);
      } else {
        parts.push(content);
      }
      sources.push(fragmentPath);
    }
  }

  return {
    content: parts.join('\n\n---\n\n'),
    sources
  };
}

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
  const contentMatch = file.content?.match(/## Description\s*([\s\S]*?)(?=\n## |$)/);
  const description = contentMatch ? contentMatch[1].trim() : '';

  // Extract Technical Notes section
  const techMatch = file.content?.match(/## Technical Notes\s*([\s\S]*?)(?=\n## |$)/);
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
 * Register assignment commands
 */
export function registerAssignCommands(program) {
  const assign = program.command('assign')
    .description('Assignment operations (skill → agent prompt)');

  // assign:create TNNN --operation <op>
  assign.command('create <task-id>')
    .description('Create an assignment for a task')
    .requiredOption('--operation <op>', 'Operation type (task-start, etc.)')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
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

      fs.writeFileSync(filePath, yaml.dump(assignment));

      if (options.json) {
        jsonOut(assignment);
      } else {
        console.log(`Created assignment: ${normalized}`);
        console.log(`  Operation: ${options.operation}`);
        console.log(`  Path: ${filePath}`);
      }
    });

  // assign:claim TNNN
  assign.command('claim <task-id>')
    .description('Claim assignment and get compiled prompt (works without prior create)')
    .option('--operation <op>', 'Operation type (default: task-start)', 'task-start')
    .option('--sources', 'Show fragment sources used')
    .option('--debug', 'Add source comments to each section')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      const normalized = normalizeId(taskId);
      const filePath = assignmentPath(normalized);

      let assignment;
      let tracked = false;  // Whether we're tracking with a file

      if (fs.existsSync(filePath)) {
        // Existing assignment (worktree mode)
        assignment = yaml.load(fs.readFileSync(filePath, 'utf8'));
        tracked = true;

        if (assignment.status === 'claimed') {
          console.error(`Assignment already claimed at ${assignment.claimed_at}`);
          process.exit(1);
        }

        if (assignment.status === 'complete') {
          console.error(`Assignment already complete at ${assignment.completed_at}`);
          process.exit(1);
        }
      } else {
        // No assignment file - just compile prompt (non-worktree mode)
        const taskFile = findTaskFile(normalized);
        if (!taskFile) {
          console.error(`Task not found: ${normalized}`);
          process.exit(1);
        }

        const file = loadFile(taskFile);
        const parent = file.data?.parent || '';
        const epicMatch = parent.match(/E(\d+)/i);
        const epicId = epicMatch ? normalizeId(`E${epicMatch[1]}`) : null;

        assignment = {
          taskId: normalized,
          epicId,
          operation: options.operation
        };
        // Don't create file - just generate prompt
      }

      // Build compiled prompt
      const promptParts = [];
      const debug = options.debug;

      // 1. Agent Contract (from context:agent fragments)
      const agentContext = composeAgentContext(assignment.operation, debug);
      if (agentContext.content) {
        // No separate header - fragments compose directly
        if (debug) {
          promptParts.push(`<!-- section: Agent Contract (${agentContext.sources.length} fragments) -->\n${agentContext.content}`);
        } else {
          promptParts.push(agentContext.content);
        }
      }

      // 2. Memory (from epic)
      const memory = getTaskMemory(normalized);
      if (memory.content) {
        const memoryPath = `.sailing/memory/${memory.epicId}.md`;
        const header = debug
          ? `<!-- section: Memory, source: ${memoryPath} -->\n# Memory: ${memory.epicId}`
          : `# Memory: ${memory.epicId}`;
        promptParts.push(`${header}\n\n${memory.content}`);
      }

      // 3. Epic Context
      if (assignment.epicId) {
        const epic = getEpicSummary(assignment.epicId);
        if (epic) {
          const epicPath = epic.filePath || `epics/${assignment.epicId}-*.md`;
          const header = debug
            ? `<!-- section: Epic, source: ${epicPath} -->\n# Epic: ${epic.id}`
            : `# Epic: ${epic.id}`;
          let epicSection = `${header}\n\n**Title**: ${epic.title}\n**Parent**: ${epic.parent}`;
          if (epic.description) {
            epicSection += `\n\n## Description\n\n${epic.description}`;
          }
          if (epic.techNotes) {
            epicSection += `\n\n## Technical Notes\n\n${epic.techNotes}`;
          }
          promptParts.push(epicSection);
        }
      }

      // 4. Task (full file)
      const taskFile = findTaskFile(normalized);
      const taskContent = getTaskDetails(normalized);
      if (taskContent) {
        const header = debug
          ? `<!-- section: Task, source: ${taskFile} -->\n# Task: ${normalized}`
          : `# Task: ${normalized}`;
        promptParts.push(`${header}\n\n${taskContent}`);
      }

      const compiledPrompt = promptParts.join('\n\n---\n\n');

      // Update assignment status only if tracked (worktree mode)
      if (tracked) {
        assignment.status = 'claimed';
        assignment.claimed_at = new Date().toISOString();
        fs.writeFileSync(filePath, yaml.dump(assignment));
      }

      if (options.json) {
        jsonOut({
          taskId: normalized,
          operation: assignment.operation,
          sources: agentContext.sources,
          memoryEpic: memory.epicId,
          tracked,
          prompt: compiledPrompt
        });
        return;
      }

      if (options.sources) {
        console.log(`# Assignment: ${normalized}${tracked ? '' : ' (untracked)'}`);
        console.log(`# Operation: ${assignment.operation}`);
        console.log(`# Context sources: ${agentContext.sources.join(', ')}`);
        if (memory.epicId) {
          console.log(`# Memory from: ${memory.epicId}`);
        }
        console.log('\n');
      }

      console.log(compiledPrompt);
    });

  // assign:show TNNN
  assign.command('show <task-id>')
    .description('Show assignment status')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
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
    .action((options) => {
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
  assign.command('complete <task-id>')
    .description('Mark an assignment as complete')
    .option('--success', 'Mark as successful completion')
    .option('--failure', 'Mark as failed completion')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
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
  assign.command('delete <task-id>')
    .description('Delete an assignment')
    .option('--force', 'Force delete even if claimed')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
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
  addDynamicHelp(assign, `
• create <task-id>
    --operation <op>      Operation type (task-start, etc.) [required]
    --json                JSON output

• claim <task-id>
    --sources             Show fragment sources used
    --json                JSON output

• show <task-id>
    --json                JSON output

• list
    --status <status>     Filter by status (pending, claimed, complete)
    --json                JSON output

• complete <task-id>
    --success             Mark as successful completion
    --failure             Mark as failed completion
    --json                JSON output

• delete <task-id>
    --force               Force delete even if claimed
    --json                JSON output
`);
}

/**
 * Time since helper
 */
function timeSince(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
