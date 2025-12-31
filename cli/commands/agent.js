/**
 * Agent commands for rudder CLI
 * Manages agent lifecycle: dispatch, collect, status
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { execSync } from 'child_process';
import { findProjectRoot, loadFile, jsonOut, getPrdsDir, getMemoryDir } from '../lib/core.js';
import { resolvePlaceholders, resolvePath, ensureDir } from '../lib/paths.js';
import { createMission, validateMission, validateResult, getProtocolVersion } from '../lib/agent-schema.js';
import { loadState, saveState } from '../lib/state.js';
import { addDynamicHelp } from '../lib/help.js';
import { getAgentConfig } from '../lib/config.js';
import { createWorktree, getWorktreePath, getBranchName, worktreeExists, removeWorktree, getWorktreeStatus } from '../lib/worktree.js';
import { spawnClaude, buildPromptFromMission, getLogFilePath } from '../lib/claude.js';
import { buildConflictMatrix, suggestMergeOrder, canMergeWithoutConflict } from '../lib/conflicts.js';

/**
 * Get agents base directory (overridable via paths.yaml: agents)
 * Default: %haven%/agents
 */
function getAgentsBaseDir() {
  const custom = resolvePath('agents');
  return custom || resolvePlaceholders('%haven%/agents');
}

/**
 * Get agent directory for a task
 */
function getAgentDir(taskId) {
  return path.join(getAgentsBaseDir(), taskId);
}

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
 * Extract PRD ID from parent field (e.g., "PRD-001 / E002" -> "PRD-001")
 */
function extractPrdId(parent) {
  if (!parent) return null;
  const match = parent.match(/PRD-\d+/);
  return match ? match[0] : null;
}

/**
 * Extract Epic ID from parent field (e.g., "PRD-001 / E002" -> "E002")
 */
function extractEpicId(parent) {
  if (!parent) return null;
  const match = parent.match(/E\d+/);
  return match ? match[0] : null;
}

/**
 * Find DEV.md file (check project root and common locations)
 */
function findDevMd() {
  const projectRoot = findProjectRoot();
  const candidates = [
    path.join(projectRoot, 'DEV.md'),
    path.join(projectRoot, 'DEVELOPMENT.md'),
    path.join(projectRoot, 'docs', 'DEV.md'),
    path.join(projectRoot, 'docs', 'DEVELOPMENT.md')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Find TOOLSET.md file
 */
function findToolset() {
  const projectRoot = findProjectRoot();
  const candidates = [
    path.join(projectRoot, '.claude', 'TOOLSET.md'),
    path.join(projectRoot, 'TOOLSET.md')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Find memory file for epic
 */
function findMemoryFile(epicId) {
  const memoryPath = path.join(getMemoryDir(), `${epicId}.md`);
  return fs.existsSync(memoryPath) ? memoryPath : null;
}

/**
 * Register agent commands
 */
export function registerAgentCommands(program) {
  const agent = program.command('agent')
    .description('Agent lifecycle management');

  addDynamicHelp(agent, { entityType: 'agent' });

  // agent:dispatch (DEPRECATED - use agent:spawn)
  agent.command('dispatch <task-id>')
    .description('[DEPRECATED] Use agent:spawn instead')
    .option('--timeout <seconds>', 'Execution timeout (default: 600)', parseInt, 600)
    .option('--worktree', 'Create isolated worktree for agent (overrides config)')
    .option('--no-worktree', 'Skip worktree creation (overrides config)')
    .option('--dry-run', 'Show mission without creating files')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      // Normalize task ID
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) {
        taskId = 'T' + taskId;
      }

      // Find task file
      const taskFile = findTaskFile(taskId);
      if (!taskFile) {
        console.error(`Task not found: ${taskId}`);
        process.exit(1);
      }

      // Load task data
      const task = loadFile(taskFile);
      if (!task) {
        console.error(`Could not load task file: ${taskFile}`);
        process.exit(1);
      }

      // Extract IDs
      const prdId = extractPrdId(task.data.parent);
      const epicId = extractEpicId(task.data.parent);

      if (!prdId || !epicId) {
        console.error(`Could not extract PRD/Epic IDs from parent: ${task.data.parent}`);
        process.exit(1);
      }

      // Find context files
      const epicFile = findEpicFile(epicId);
      const devMd = findDevMd();
      const toolset = findToolset();
      const memory = findMemoryFile(epicId);

      if (!epicFile) {
        console.error(`Epic file not found: ${epicId}`);
        process.exit(1);
      }

      // Build instruction from task body
      const instruction = task.body.trim();

      // Create mission
      const mission = createMission({
        task_id: taskId,
        epic_id: epicId,
        prd_id: prdId,
        instruction: instruction,
        dev_md: devMd || '',
        epic_file: epicFile,
        task_file: taskFile,
        memory: memory,
        toolset: toolset,
        constraints: {
          no_git_commit: true
        },
        timeout: options.timeout
      });

      // Validate mission
      const errors = validateMission(mission);
      if (errors.length > 0) {
        console.error('Invalid mission:');
        errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }

      // Determine agent directory
      const agentDir = ensureDir(getAgentDir(taskId));
      const missionFile = path.join(agentDir, 'mission.yaml');

      if (options.dryRun) {
        // Check worktree config for dry-run display
        const agentConfig = getAgentConfig();
        let useWorktree = agentConfig.use_worktrees;
        if (options.worktree === true) useWorktree = true;
        else if (options.worktree === false) useWorktree = false;

        console.log('Mission (dry run):\n');
        console.log(yaml.dump(mission));
        console.log(`\nWould create: ${missionFile}`);
        if (useWorktree) {
          console.log(`Would create worktree: ${getWorktreePath(taskId)}`);
          console.log(`Would create branch: ${getBranchName(taskId)}`);
        }
        return;
      }

      // Check if already dispatched
      const state = loadState();
      if (!state.agents) state.agents = {};

      if (state.agents[taskId] && state.agents[taskId].status === 'dispatched') {
        console.error(`Task ${taskId} is already dispatched`);
        console.error(`  Mission: ${missionFile}`);
        process.exit(1);
      }

      // Determine if worktree should be created
      const agentConfig = getAgentConfig();
      let useWorktree = agentConfig.use_worktrees;

      // CLI flags override config
      if (options.worktree === true) {
        useWorktree = true;
      } else if (options.worktree === false) {
        useWorktree = false;
      }

      // Create worktree if enabled
      let worktreeInfo = null;
      if (useWorktree) {
        if (worktreeExists(taskId)) {
          console.error(`Worktree already exists for ${taskId}`);
          console.error(`  Path: ${getWorktreePath(taskId)}`);
          process.exit(1);
        }

        const result = createWorktree(taskId);
        if (!result.success) {
          console.error(`Failed to create worktree: ${result.error}`);
          process.exit(1);
        }

        worktreeInfo = {
          path: result.path,
          branch: result.branch,
          base_branch: result.baseBranch
        };

        if (!options.json && !options.dryRun) {
          console.log(`Worktree created: ${result.path}`);
          console.log(`  Branch: ${result.branch}`);
        }
      }

      // Write mission file
      fs.writeFileSync(missionFile, yaml.dump(mission));

      // Update state
      state.agents[taskId] = {
        status: 'dispatched',
        started_at: new Date().toISOString(),
        mission_file: missionFile,
        ...(worktreeInfo && { worktree: worktreeInfo })
      };
      saveState(state);

      if (options.json) {
        jsonOut({
          task_id: taskId,
          mission_file: missionFile,
          agent_dir: agentDir,
          ...(worktreeInfo && { worktree: worktreeInfo })
        });
      } else {
        console.log(`Dispatched: ${taskId}`);
        console.log(`  Mission: ${missionFile}`);
        console.log(`  Agent dir: ${agentDir}`);
        if (worktreeInfo) {
          console.log(`  Worktree: ${worktreeInfo.path}`);
          console.log(`  Branch: ${worktreeInfo.branch}`);
        }
      }
    });

  // agent:spawn - merged dispatch + run with bootstrap prompt
  agent.command('spawn <task-id>')
    .description('Spawn agent to execute task (creates worktree, spawns Claude)')
    .option('--timeout <seconds>', 'Execution timeout (default: 600)', parseInt)
    .option('--worktree', 'Create isolated worktree (overrides config)')
    .option('--no-worktree', 'Skip worktree creation (overrides config)')
    .option('--dry-run', 'Show what would be done without spawning')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      // Normalize task ID
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) {
        taskId = 'T' + taskId;
      }

      // Find task file
      const taskFile = findTaskFile(taskId);
      if (!taskFile) {
        console.error(`Task not found: ${taskId}`);
        process.exit(1);
      }

      // Load task data
      const task = loadFile(taskFile);
      if (!task) {
        console.error(`Could not load task file: ${taskFile}`);
        process.exit(1);
      }

      // Extract IDs
      const prdId = extractPrdId(task.data.parent);
      const epicId = extractEpicId(task.data.parent);

      if (!prdId || !epicId) {
        console.error(`Could not extract PRD/Epic IDs from parent: ${task.data.parent}`);
        process.exit(1);
      }

      // Check if already running
      const state = loadState();
      if (!state.agents) state.agents = {};

      if (state.agents[taskId]) {
        const status = state.agents[taskId].status;
        if (status === 'running' || status === 'spawned') {
          console.error(`Agent ${taskId} is already running (status: ${status})`);
          process.exit(1);
        }
      }

      // Determine agent directory
      const agentDir = ensureDir(getAgentDir(taskId));

      // Determine if worktree should be created
      const agentConfig = getAgentConfig();
      let useWorktree = agentConfig.use_worktrees;
      if (options.worktree === true) useWorktree = true;
      else if (options.worktree === false) useWorktree = false;

      // Get timeout
      const timeout = options.timeout || agentConfig.timeout || 600;

      // Create mission.yaml for debug/trace
      const mission = createMission({
        task_id: taskId,
        epic_id: epicId,
        prd_id: prdId,
        instruction: task.body.trim(),
        dev_md: findDevMd() || '',
        epic_file: findEpicFile(epicId),
        task_file: taskFile,
        memory: findMemoryFile(epicId),
        toolset: findToolset(),
        constraints: { no_git_commit: true },
        timeout
      });
      const missionFile = path.join(agentDir, 'mission.yaml');

      // Build bootstrap prompt
      const bootstrapPrompt = `# Agent Bootstrap: ${taskId}

You are an autonomous agent assigned to task ${taskId}.

## Instructions

1. **Get your context** by running:
   \`\`\`bash
   rudder assign:claim ${taskId}
   \`\`\`
   This will output your full instructions, memory, and task details.

2. **Execute the task** according to the deliverables.

3. **Log tips** during your work (at least 1):
   \`\`\`bash
   rudder task:log ${taskId} "useful insight for future agents" --tip
   \`\`\`

4. **When complete**, run:
   \`\`\`bash
   rudder assign:release ${taskId}
   \`\`\`

## Constraints

- NO git commit (user will commit after review)
- Follow the task deliverables exactly
- Log meaningful tips for knowledge transfer

Start by running \`rudder assign:claim ${taskId}\` to get your instructions.
`;

      if (options.dryRun) {
        console.log('Agent spawn (dry run):\n');
        console.log(`Task: ${taskId}`);
        console.log(`Epic: ${epicId}, PRD: ${prdId}`);
        console.log(`Worktree: ${useWorktree ? 'yes' : 'no'}`);
        console.log(`Timeout: ${timeout}s`);
        console.log(`Agent dir: ${agentDir}`);
        console.log(`\nBootstrap prompt:\n${bootstrapPrompt}`);
        return;
      }

      // Create worktree if enabled
      let worktreeInfo = null;
      let cwd = findProjectRoot();

      if (useWorktree) {
        if (worktreeExists(taskId)) {
          console.error(`Worktree already exists for ${taskId}`);
          console.error(`  Path: ${getWorktreePath(taskId)}`);
          process.exit(1);
        }

        const result = createWorktree(taskId);
        if (!result.success) {
          console.error(`Failed to create worktree: ${result.error}`);
          process.exit(1);
        }

        worktreeInfo = {
          path: result.path,
          branch: result.branch,
          base_branch: result.baseBranch
        };
        cwd = result.path;

        if (!options.json) {
          console.log(`Worktree created: ${result.path}`);
          console.log(`  Branch: ${result.branch}`);
        }
      }

      // Write mission file (for debug/trace)
      fs.writeFileSync(missionFile, yaml.dump(mission));

      // Get log file path
      const logFile = getLogFilePath(taskId);

      // Spawn Claude with bootstrap prompt
      const spawnResult = spawnClaude({
        prompt: bootstrapPrompt,
        cwd,
        logFile,
        timeout
      });

      // Update state
      state.agents[taskId] = {
        status: 'spawned',
        spawned_at: new Date().toISOString(),
        pid: spawnResult.pid,
        mission_file: missionFile,
        log_file: spawnResult.logFile,
        timeout,
        ...(worktreeInfo && { worktree: worktreeInfo })
      };
      saveState(state);

      // Handle process exit
      spawnResult.process.on('exit', (code, signal) => {
        const currentState = loadState();
        if (currentState.agents[taskId]) {
          currentState.agents[taskId].status = code === 0 ? 'completed' : 'error';
          currentState.agents[taskId].exit_code = code;
          currentState.agents[taskId].exit_signal = signal;
          currentState.agents[taskId].ended_at = new Date().toISOString();
          delete currentState.agents[taskId].pid;
          saveState(currentState);
        }
      });

      if (options.json) {
        jsonOut({
          task_id: taskId,
          epic_id: epicId,
          prd_id: prdId,
          pid: spawnResult.pid,
          cwd,
          log_file: spawnResult.logFile,
          mission_file: missionFile,
          timeout,
          ...(worktreeInfo && { worktree: worktreeInfo })
        });
      } else {
        console.log(`Spawned: ${taskId}`);
        console.log(`  PID: ${spawnResult.pid}`);
        console.log(`  CWD: ${cwd}`);
        console.log(`  Log: ${spawnResult.logFile}`);
        console.log(`  Mission: ${missionFile}`);
        console.log(`  Timeout: ${timeout}s`);
      }
    });

  /**
   * Check agent completion state
   * @returns {{ complete: boolean, hasResult: boolean, hasSentinel: boolean }}
   */
  function checkAgentCompletion(taskId) {
    const agentDir = getAgentDir(taskId);
    const resultFile = path.join(agentDir, 'result.yaml');
    const sentinelFile = path.join(agentDir, 'done');

    return {
      complete: fs.existsSync(sentinelFile) || fs.existsSync(resultFile),
      hasResult: fs.existsSync(resultFile),
      hasSentinel: fs.existsSync(sentinelFile),
      agentDir
    };
  }

  // agent:status
  agent.command('status [task-id]')
    .description('Show agent status (all or specific task)')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      const state = loadState();
      const agents = state.agents || {};

      if (taskId) {
        taskId = taskId.toUpperCase();
        if (!taskId.startsWith('T')) taskId = 'T' + taskId;

        const agent = agents[taskId];
        if (!agent) {
          console.error(`No agent found for task: ${taskId}`);
          process.exit(1);
        }

        // Check completion state
        const completion = checkAgentCompletion(taskId);
        const liveStatus = completion.complete ? 'complete' : agent.status;

        if (options.json) {
          jsonOut({
            task_id: taskId,
            ...agent,
            live_status: liveStatus,
            ...completion
          });
        } else {
          console.log(`Agent: ${taskId}`);
          console.log(`  Status: ${agent.status}${completion.complete ? ' (complete)' : ''}`);
          console.log(`  Started: ${agent.started_at}`);
          console.log(`  Mission: ${agent.mission_file}`);
          console.log(`  Complete: ${completion.complete ? 'yes' : 'no'}`);
          if (completion.hasResult) console.log(`  Result: ${path.join(completion.agentDir, 'result.yaml')}`);
          if (completion.hasSentinel) console.log(`  Sentinel: ${path.join(completion.agentDir, 'done')}`);
          if (agent.completed_at) {
            console.log(`  Collected: ${agent.completed_at}`);
          }
        }
        return;
      }

      // Show all agents with live completion status
      const agentList = Object.entries(agents).map(([id, data]) => {
        const completion = checkAgentCompletion(id);
        return {
          task_id: id,
          ...data,
          live_complete: completion.complete
        };
      });

      if (options.json) {
        jsonOut(agentList);
        return;
      }

      if (agentList.length === 0) {
        console.log('No active agents');
        return;
      }

      console.log('Active agents:\n');
      for (const agent of agentList) {
        let status;
        if (agent.live_complete) {
          status = '✓';
        } else if (agent.status === 'dispatched') {
          status = '●';
        } else if (agent.status === 'collected') {
          status = '✓';
        } else {
          status = '✗';
        }
        const completeNote = agent.live_complete && agent.status === 'dispatched' ? ' [ready to collect]' : '';
        console.log(`  ${status} ${agent.task_id}: ${agent.status}${completeNote}`);
      }
    });

  // agent:wait
  agent.command('wait <task-id>')
    .description('Wait for agent to complete (polls for sentinel/result)')
    .option('--timeout <seconds>', 'Timeout in seconds (default: 3600)', parseInt, 3600)
    .option('--interval <seconds>', 'Poll interval in seconds (default: 5)', parseInt, 5)
    .option('--json', 'JSON output')
    .action(async (taskId, options) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const state = loadState();
      const agent = state.agents?.[taskId];

      if (!agent) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(3); // not found
      }

      const startTime = Date.now();
      const timeoutMs = options.timeout * 1000;
      const intervalMs = options.interval * 1000;

      if (!options.json) {
        console.log(`Waiting for ${taskId} (timeout: ${options.timeout}s, interval: ${options.interval}s)`);
      }

      while (true) {
        const completion = checkAgentCompletion(taskId);

        if (completion.complete) {
          if (options.json) {
            jsonOut({
              task_id: taskId,
              status: 'complete',
              has_result: completion.hasResult,
              has_sentinel: completion.hasSentinel,
              elapsed_ms: Date.now() - startTime
            });
          } else {
            console.log(`✓ ${taskId} complete`);
            if (completion.hasResult) {
              console.log(`  Result: ${path.join(completion.agentDir, 'result.yaml')}`);
            }
          }
          process.exit(0); // complete
        }

        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          if (options.json) {
            jsonOut({
              task_id: taskId,
              status: 'timeout',
              elapsed_ms: Date.now() - startTime
            });
          } else {
            console.error(`✗ Timeout waiting for ${taskId}`);
          }
          process.exit(2); // timeout
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, intervalMs));

        if (!options.json) {
          process.stdout.write('.');
        }
      }
    });

  // agent:run (DEPRECATED - use agent:spawn)
  agent.command('run <task-id>')
    .description('[DEPRECATED] Use agent:spawn instead')
    .option('--timeout <seconds>', 'Execution timeout in seconds (overrides config)', parseInt)
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const state = loadState();
      const agentInfo = state.agents?.[taskId];

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        console.error('Use agent:dispatch first to create a mission');
        process.exit(1);
      }

      if (agentInfo.status !== 'dispatched') {
        console.error(`Agent ${taskId} is not in dispatched state (current: ${agentInfo.status})`);
        process.exit(1);
      }

      // Load mission file
      const missionFile = agentInfo.mission_file;
      if (!fs.existsSync(missionFile)) {
        console.error(`Mission file not found: ${missionFile}`);
        process.exit(1);
      }

      let mission;
      try {
        const content = fs.readFileSync(missionFile, 'utf8');
        mission = yaml.load(content);
      } catch (e) {
        console.error(`Error reading mission file: ${e.message}`);
        process.exit(1);
      }

      // Determine working directory
      let cwd;
      if (agentInfo.worktree) {
        cwd = agentInfo.worktree.path;
        if (!fs.existsSync(cwd)) {
          console.error(`Worktree not found: ${cwd}`);
          process.exit(1);
        }
      } else {
        // Use project root if no worktree
        cwd = findProjectRoot();
      }

      // Get timeout from options, mission, or config
      const config = getAgentConfig();
      const timeout = options.timeout || mission.timeout || config.timeout;

      // Build prompt from mission
      const prompt = buildPromptFromMission(mission);
      const logFile = getLogFilePath(taskId);

      // Spawn Claude
      const result = spawnClaude({
        prompt,
        cwd,
        logFile,
        timeout
      });

      // Update state with PID
      state.agents[taskId] = {
        ...agentInfo,
        status: 'running',
        pid: result.pid,
        log_file: result.logFile,
        run_started_at: new Date().toISOString()
      };
      saveState(state);

      // Handle process exit
      result.process.on('exit', (code, signal) => {
        const currentState = loadState();
        if (currentState.agents[taskId]) {
          currentState.agents[taskId].status = code === 0 ? 'dispatched' : 'error';
          currentState.agents[taskId].exit_code = code;
          currentState.agents[taskId].exit_signal = signal;
          currentState.agents[taskId].run_ended_at = new Date().toISOString();
          delete currentState.agents[taskId].pid;
          saveState(currentState);
        }
      });

      if (options.json) {
        jsonOut({
          task_id: taskId,
          pid: result.pid,
          cwd,
          log_file: result.logFile,
          timeout
        });
      } else {
        console.log(`Running: ${taskId}`);
        console.log(`  PID: ${result.pid}`);
        console.log(`  CWD: ${cwd}`);
        console.log(`  Log: ${result.logFile}`);
        console.log(`  Timeout: ${timeout}s`);
        if (agentInfo.worktree) {
          console.log(`  Worktree: ${agentInfo.worktree.branch}`);
        }
      }
    });

  // agent:collect
  agent.command('collect <task-id>')
    .description('Collect agent result and update task status')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      // Normalize task ID
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) {
        taskId = 'T' + taskId;
      }

      const state = loadState();
      const agentInfo = state.agents?.[taskId];

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        console.error('Use agent:dispatch first to create a mission');
        process.exit(1);
      }

      // Find result file
      const agentDir = getAgentDir(taskId);
      const resultFile = path.join(agentDir, 'result.yaml');

      if (!fs.existsSync(resultFile)) {
        console.error(`Result file not found: ${resultFile}`);
        console.error('Agent has not completed execution');
        process.exit(1);
      }

      // Load and validate result
      let result;
      try {
        const content = fs.readFileSync(resultFile, 'utf8');
        result = yaml.load(content);
      } catch (e) {
        console.error(`Error reading result file: ${e.message}`);
        process.exit(1);
      }

      const errors = validateResult(result);
      if (errors.length > 0) {
        console.error('Invalid result:');
        errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }

      // Map result status to task status
      const statusMap = {
        completed: 'Done',
        failed: 'Blocked',
        blocked: 'Blocked'
      };
      const taskStatus = statusMap[result.status] || 'Blocked';

      // Check for worktree mode and get worktree-specific info
      let worktreeInfo = null;
      if (agentInfo.worktree) {
        const worktreePath = agentInfo.worktree.path;
        if (fs.existsSync(worktreePath)) {
          try {
            // Get files modified in worktree
            const diffOutput = execSync('git diff --name-only HEAD', {
              cwd: worktreePath,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe']
            }).trim();

            // Get uncommitted files (staged + unstaged)
            const statusOutput = execSync('git status --porcelain', {
              cwd: worktreePath,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe']
            }).trim();

            // Parse status to get changed files
            const changedFiles = statusOutput
              .split('\n')
              .filter(line => line.trim())
              .map(line => ({
                status: line.substring(0, 2).trim(),
                file: line.substring(3)
              }));

            // Get commit count ahead of base branch
            let commitsAhead = 0;
            try {
              const countOutput = execSync('git rev-list --count HEAD ^origin/HEAD 2>/dev/null || echo 0', {
                cwd: worktreePath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
              }).trim();
              commitsAhead = parseInt(countOutput, 10) || 0;
            } catch {
              // No upstream or base, ignore
            }

            worktreeInfo = {
              path: worktreePath,
              branch: agentInfo.worktree.branch,
              base_branch: agentInfo.worktree.base_branch,
              changed_files: changedFiles,
              commits_ahead: commitsAhead,
              ready_for_merge: result.status === 'completed' && changedFiles.length > 0
            };
          } catch (e) {
            worktreeInfo = {
              path: worktreePath,
              branch: agentInfo.worktree.branch,
              error: e.message
            };
          }
        }
      }

      // Update agent tracking
      state.agents[taskId] = {
        ...agentInfo,
        status: 'collected',
        result_status: result.status,
        completed_at: result.completed_at,
        files_modified: result.files_modified?.length || 0,
        issues: result.issues?.length || 0,
        ...(worktreeInfo && { worktree_status: worktreeInfo })
      };
      saveState(state);

      // Build output
      const output = {
        task_id: taskId,
        result_status: result.status,
        task_status: taskStatus,
        files_modified: result.files_modified || [],
        log_entries: result.log?.length || 0,
        issues: result.issues || [],
        completed_at: result.completed_at,
        ...(worktreeInfo && { worktree: worktreeInfo })
      };

      if (options.json) {
        jsonOut(output);
        return;
      }

      // Human readable output
      const statusSymbol = result.status === 'completed' ? '✓' :
                           result.status === 'failed' ? '✗' : '⚠';
      console.log(`${statusSymbol} Collected: ${taskId}`);
      console.log(`  Result: ${result.status} → Task: ${taskStatus}`);
      console.log(`  Files: ${result.files_modified?.length || 0} modified`);
      console.log(`  Log: ${result.log?.length || 0} entries`);

      if (result.issues?.length > 0) {
        console.log(`\n  Issues (${result.issues.length}):`);
        result.issues.forEach(issue => {
          console.log(`    - [${issue.type}] ${issue.description}`);
        });
      }

      // Show worktree info if present
      if (worktreeInfo) {
        console.log(`\n  Worktree:`);
        console.log(`    Branch: ${worktreeInfo.branch}`);
        console.log(`    Path: ${worktreeInfo.path}`);
        if (worktreeInfo.changed_files?.length > 0) {
          console.log(`    Changed files (${worktreeInfo.changed_files.length}):`);
          worktreeInfo.changed_files.slice(0, 10).forEach(f => {
            console.log(`      ${f.status} ${f.file}`);
          });
          if (worktreeInfo.changed_files.length > 10) {
            console.log(`      ... and ${worktreeInfo.changed_files.length - 10} more`);
          }
        }
        if (worktreeInfo.ready_for_merge) {
          console.log(`\n  ✓ Ready for merge: rudder agent:merge ${taskId}`);
        }
      }

      console.log(`\nTo update task status: rudder task:update ${taskId} --status "${taskStatus}"`);
    });

  // agent:clear
  agent.command('clear [task-id]')
    .description('Clear agent tracking (all or specific task)')
    .option('--force', 'Clear without confirmation')
    .action((taskId, options) => {
      const state = loadState();

      if (!state.agents) {
        console.log('No agents to clear');
        return;
      }

      if (taskId) {
        taskId = taskId.toUpperCase();
        if (!taskId.startsWith('T')) taskId = 'T' + taskId;

        if (!state.agents[taskId]) {
          console.error(`No agent found for task: ${taskId}`);
          process.exit(1);
        }

        delete state.agents[taskId];
        saveState(state);
        console.log(`Cleared agent: ${taskId}`);
      } else {
        const count = Object.keys(state.agents).length;
        state.agents = {};
        saveState(state);
        console.log(`Cleared ${count} agent(s)`);
      }
    });

  // agent:merge
  agent.command('merge <task-id>')
    .description('Merge agent worktree changes into main branch')
    .option('--strategy <type>', 'Merge strategy: merge|squash|rebase (default from config)')
    .option('--no-cleanup', 'Keep worktree after merge')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const state = loadState();
      const agentInfo = state.agents?.[taskId];

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(1);
      }

      if (!agentInfo.worktree) {
        console.error(`Task ${taskId} was not dispatched with worktree mode`);
        process.exit(1);
      }

      // Check agent completed
      const completion = checkAgentCompletion(taskId);
      if (!completion.complete) {
        console.error(`Agent ${taskId} has not completed`);
        console.error('Use agent:wait to wait for completion, or check agent:status');
        process.exit(1);
      }

      const projectRoot = findProjectRoot();
      const worktreePath = agentInfo.worktree.path;
      const branch = agentInfo.worktree.branch;

      if (!fs.existsSync(worktreePath)) {
        console.error(`Worktree not found: ${worktreePath}`);
        process.exit(1);
      }

      // Get merge strategy from options or config
      const config = getAgentConfig();
      const strategy = options.strategy || config.merge_strategy || 'merge';
      const validStrategies = ['merge', 'squash', 'rebase'];

      if (!validStrategies.includes(strategy)) {
        console.error(`Invalid merge strategy: ${strategy}`);
        console.error(`Valid strategies: ${validStrategies.join(', ')}`);
        process.exit(1);
      }

      // Check for conflicts using merge-tree
      try {
        // Get merge base
        const mergeBase = execSync(`git merge-base HEAD ${branch}`, {
          cwd: projectRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        // Check for conflicts
        const mergeTree = execSync(`git merge-tree ${mergeBase} HEAD ${branch}`, {
          cwd: projectRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // If merge-tree output contains conflict markers, there are conflicts
        if (mergeTree.includes('<<<<<<<') || mergeTree.includes('>>>>>>>')) {
          console.error(`Merge conflicts detected. Please resolve manually.`);
          console.error(`Worktree: ${worktreePath}`);
          console.error(`Branch: ${branch}`);
          process.exit(1);
        }
      } catch (e) {
        // merge-tree might fail if branch doesn't exist or other issues
        console.error(`Error checking for conflicts: ${e.message}`);
        process.exit(1);
      }

      // Execute merge based on strategy
      try {
        if (strategy === 'merge') {
          execSync(`git merge ${branch} --no-edit`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: 'inherit'
          });
        } else if (strategy === 'squash') {
          execSync(`git merge --squash ${branch}`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: 'inherit'
          });
          // Note: squash doesn't auto-commit, user needs to commit
          console.log('\nSquash complete. Changes are staged but not committed.');
          console.log('Please review and commit the changes.');
        } else if (strategy === 'rebase') {
          execSync(`git rebase ${branch}`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: 'inherit'
          });
        }
      } catch (e) {
        console.error(`Merge failed: ${e.message}`);
        console.error('Please resolve manually and try again');
        process.exit(1);
      }

      // Cleanup worktree if not --no-cleanup
      if (options.cleanup !== false) {
        const removeResult = removeWorktree(taskId, { force: true });
        if (!removeResult.success) {
          console.error(`Warning: Failed to remove worktree: ${removeResult.error}`);
        }
      }

      // Update state
      state.agents[taskId] = {
        ...agentInfo,
        status: 'merged',
        merge_strategy: strategy,
        merged_at: new Date().toISOString()
      };
      saveState(state);

      if (options.json) {
        jsonOut({
          task_id: taskId,
          status: 'merged',
          strategy,
          branch,
          cleanup: options.cleanup !== false
        });
      } else {
        console.log(`\n✓ Merged: ${taskId}`);
        console.log(`  Strategy: ${strategy}`);
        console.log(`  Branch: ${branch}`);
        if (options.cleanup !== false) {
          console.log(`  Worktree cleaned up`);
        }
        console.log(`\nTo update task status: rudder task:done ${taskId}`);
      }
    });

  // agent:reject
  agent.command('reject <task-id>')
    .description('Reject agent work and cleanup worktree')
    .option('--reason <text>', 'Rejection reason (logged)')
    .option('--status <status>', 'New task status: blocked|not-started (default: blocked)', 'blocked')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const state = loadState();
      const agentInfo = state.agents?.[taskId];

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(1);
      }

      // Cleanup worktree if present
      if (agentInfo.worktree) {
        const removeResult = removeWorktree(taskId, { force: true });
        if (!removeResult.success) {
          console.error(`Warning: Failed to remove worktree: ${removeResult.error}`);
        }
      }

      // Map status
      const statusMap = {
        'blocked': 'Blocked',
        'not-started': 'Not Started'
      };
      const taskStatus = statusMap[options.status] || 'Blocked';

      // Update state
      state.agents[taskId] = {
        ...agentInfo,
        status: 'rejected',
        reject_reason: options.reason,
        rejected_at: new Date().toISOString()
      };
      saveState(state);

      if (options.json) {
        jsonOut({
          task_id: taskId,
          status: 'rejected',
          task_status: taskStatus,
          reason: options.reason
        });
      } else {
        console.log(`✗ Rejected: ${taskId}`);
        if (options.reason) {
          console.log(`  Reason: ${options.reason}`);
        }
        if (agentInfo.worktree) {
          console.log(`  Worktree cleaned up`);
        }
        console.log(`\nTo update task status: rudder task:update ${taskId} --status "${taskStatus}"`);
      }
    });

  // agent:list
  agent.command('list')
    .description('List all agents with status and details')
    .option('--active', 'Only show active agents (dispatched/running)')
    .option('--json', 'JSON output')
    .action((options) => {
      const state = loadState();
      const agents = state.agents || {};

      let agentList = Object.entries(agents).map(([id, info]) => {
        const completion = checkAgentCompletion(id);
        const liveComplete = completion.complete;

        return {
          task_id: id,
          status: info.status,
          live_complete: liveComplete,
          started_at: info.started_at,
          pid: info.pid,
          worktree: info.worktree?.path,
          branch: info.worktree?.branch,
          log_file: info.log_file
        };
      });

      // Filter active only
      if (options.active) {
        agentList = agentList.filter(a =>
          ['dispatched', 'running'].includes(a.status)
        );
      }

      if (options.json) {
        jsonOut(agentList);
        return;
      }

      if (agentList.length === 0) {
        console.log(options.active ? 'No active agents' : 'No agents');
        return;
      }

      // Calculate time ago
      const timeAgo = (isoDate) => {
        if (!isoDate) return '-';
        const diff = Date.now() - new Date(isoDate).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
      };

      // Print table
      console.log('TASK    STATUS      STARTED     WORKTREE');
      console.log('─'.repeat(60));

      for (const agent of agentList) {
        const status = agent.status.padEnd(11);
        const started = timeAgo(agent.started_at).padEnd(11);
        const worktree = agent.worktree || '-';

        let statusIndicator = '';
        if (agent.live_complete && agent.status === 'dispatched') {
          statusIndicator = ' ✓';
        } else if (agent.pid) {
          statusIndicator = ` (PID ${agent.pid})`;
        }

        console.log(`${agent.task_id}    ${status} ${started} ${worktree}${statusIndicator}`);
      }
    });

  // agent:kill
  agent.command('kill <task-id>')
    .description('Force-terminate a running agent')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const state = loadState();
      const agentInfo = state.agents?.[taskId];

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(1);
      }

      if (!agentInfo.pid) {
        console.error(`Agent ${taskId} has no running process`);
        console.error(`Status: ${agentInfo.status}`);
        process.exit(1);
      }

      const pid = agentInfo.pid;

      try {
        // Send SIGTERM first
        process.kill(pid, 'SIGTERM');
        console.log(`Sent SIGTERM to PID ${pid}`);

        // Wait 5 seconds, then SIGKILL if still running
        setTimeout(() => {
          try {
            // Check if process still exists
            process.kill(pid, 0);
            // Still running, send SIGKILL
            process.kill(pid, 'SIGKILL');
            console.log(`Sent SIGKILL to PID ${pid}`);
          } catch {
            // Process already terminated
          }
        }, 5000);

      } catch (e) {
        if (e.code === 'ESRCH') {
          console.log(`Process ${pid} already terminated`);
        } else {
          console.error(`Error killing process: ${e.message}`);
        }
      }

      // Update state
      state.agents[taskId] = {
        ...agentInfo,
        status: 'killed',
        killed_at: new Date().toISOString()
      };
      delete state.agents[taskId].pid;
      saveState(state);

      if (options.json) {
        jsonOut({
          task_id: taskId,
          pid,
          status: 'killed'
        });
      } else {
        console.log(`\nKilled: ${taskId}`);
        console.log('Worktree preserved for inspection');
        if (agentInfo.worktree) {
          console.log(`  Path: ${agentInfo.worktree.path}`);
        }
      }
    });

  // agent:conflicts
  agent.command('conflicts')
    .description('Show potential file conflicts between parallel agents')
    .option('--json', 'JSON output')
    .action((options) => {
      const conflictData = buildConflictMatrix();

      if (options.json) {
        jsonOut(conflictData);
        return;
      }

      if (conflictData.agents.length === 0) {
        console.log('No active agents with worktrees');
        return;
      }

      if (conflictData.agents.length === 1) {
        console.log(`Only one active agent: ${conflictData.agents[0]}`);
        console.log('No conflicts possible with a single agent');
        return;
      }

      console.log(`Active agents: ${conflictData.agents.length}\n`);

      // Show files modified by each agent
      console.log('Modified files by agent:');
      for (const [taskId, files] of Object.entries(conflictData.filesByAgent)) {
        console.log(`\n  ${taskId}:`);
        if (files.length === 0) {
          console.log('    (no changes)');
        } else {
          files.slice(0, 5).forEach(f => console.log(`    ${f}`));
          if (files.length > 5) {
            console.log(`    ... and ${files.length - 5} more`);
          }
        }
      }

      console.log();

      // Show conflicts
      if (!conflictData.hasConflicts) {
        console.log('✓ No conflicts detected');
        console.log('  All agents can be merged in any order');
      } else {
        console.log(`⚠ Conflicts detected: ${conflictData.conflicts.length}\n`);

        for (const conflict of conflictData.conflicts) {
          console.log(`  ${conflict.agents[0]} ↔ ${conflict.agents[1]} (${conflict.count} files)`);
          conflict.files.slice(0, 3).forEach(f => console.log(`    - ${f}`));
          if (conflict.files.length > 3) {
            console.log(`    ... and ${conflict.files.length - 3} more`);
          }
        }

        // Suggest merge order
        const order = suggestMergeOrder(conflictData);
        console.log('\nSuggested merge order (merge one at a time):');
        order.forEach((id, i) => console.log(`  ${i + 1}. rudder agent:merge ${id}`));
      }
    });
}
