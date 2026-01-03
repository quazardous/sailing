/**
 * Agent commands for rudder CLI
 * Manages agent lifecycle: spawn, collect, status, merge
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { execSync } from 'child_process';
import { findProjectRoot, loadFile, jsonOut } from '../lib/core.js';
import { resolvePlaceholders, resolvePath, ensureDir } from '../lib/paths.js';
import { createMission, validateMission, validateResult } from '../lib/agent-schema.js';
import { loadState, saveState, updateStateAtomic } from '../lib/state.js';
import {
  upsertAgent, getAgent, getAllAgents, deleteAgent, clearAllAgents,
  updateAgentStatus, createRun, completeRun
} from '../lib/db.js';
import { addDynamicHelp } from '../lib/help.js';
import { getAgentConfig } from '../lib/config.js';
import {
  createWorktree, getWorktreePath, getBranchName, worktreeExists, removeWorktree,
  ensureBranchHierarchy, syncParentBranch, getParentBranch, getMainBranch
} from '../lib/worktree.js';
import { spawnClaude, buildPromptFromMission, getLogFilePath } from '../lib/claude.js';
import { buildConflictMatrix, suggestMergeOrder } from '../lib/conflicts.js';
import {
  findTaskFile, findEpicFile, findMemoryFile,
  extractPrdId, extractEpicId, getPrdBranching,
  findDevMd, findToolset
} from '../lib/entities.js';

/**
 * Get agents base directory (overridable via paths.yaml: agents)
 */
function getAgentsBaseDir() {
  const custom = resolvePath('agents');
  return custom || resolvePlaceholders('${haven}/agents');
}

/**
 * Get agent directory for a task
 */
function getAgentDir(taskId) {
  return path.join(getAgentsBaseDir(), taskId);
}

/**
 * Register agent commands
 */
export function registerAgentCommands(program) {
  const agent = program.command('agent')
    .description('Agent lifecycle management');

  addDynamicHelp(agent, { entityType: 'agent' });

  // agent:spawn - creates worktree, spawns Claude with bootstrap prompt
  agent.command('spawn <task-id>')
    .description('Spawn agent to execute task (creates worktree, spawns Claude)')
    .option('--role <role>', 'Role context (skill, coordinator) - agent role blocked')
    .option('--timeout <seconds>', 'Execution timeout (default: 600)', parseInt)
    .option('--worktree', 'Create isolated worktree (overrides config)')
    .option('--no-worktree', 'Skip worktree creation (overrides config)')
    .option('--stderr-to-file [path]', 'Redirect stderr to file only (default: run.log)')
    .option('--resume', 'Reuse existing worktree (continue blocked/partial work)')
    .option('--dry-run', 'Show what would be done without spawning')
    .option('--json', 'JSON output')
    .action(async (taskId, options) => {
      // Role enforcement: agents cannot spawn other agents
      if (options.role === 'agent') {
        console.error('ERROR: agent:spawn cannot be called with --role agent');
        console.error('Agents cannot spawn other agents. Only skill or coordinator can spawn.');
        process.exit(1);
      }

      // Check subprocess mode is enabled
      const agentConfig = getAgentConfig();
      if (!agentConfig.use_subprocess) {
        console.error('ERROR: agent:spawn is disabled (use_subprocess: false)\n');
        console.error('Use Task tool with `rudder context:load <operation> --role agent` to spawn agents inline.');
        process.exit(1);
      }

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

      // Optimistic spawn: check existing state and auto-handle simple cases
      const state = loadState();
      if (!state.agents) state.agents = {};
      const projectRoot = findProjectRoot();

      // Helper for escalation with next steps
      const escalate = (reason, nextSteps) => {
        if (options.json) {
          jsonOut({
            task_id: taskId,
            status: 'blocked',
            reason,
            next_steps: nextSteps
          });
        } else {
          console.error(`\nBLOCKED: ${reason}\n`);
          console.error('Next steps:');
          nextSteps.forEach(step => console.error(`  ${step}`));
        }
        process.exit(1);
      };

      if (state.agents[taskId]) {
        const agentInfo = state.agents[taskId];
        const status = agentInfo.status;

        // Check if process is actually running
        let isRunning = false;
        if (agentInfo.pid) {
          try {
            process.kill(agentInfo.pid, 0);
            isRunning = true;
          } catch { /* not running */ }
        }

        if (isRunning) {
          escalate(`Agent ${taskId} is still running (PID ${agentInfo.pid})`, [
            `agent:wait ${taskId}     # Wait for completion`,
            `agent:kill ${taskId}     # Force terminate`,
            `agent:reap ${taskId}     # Wait + harvest results`
          ]);
        }

        // Check worktree state
        if (agentInfo.worktree) {
          const worktreePath = agentInfo.worktree.path;
          const branch = agentInfo.worktree.branch;

          if (fs.existsSync(worktreePath)) {
            // Check for uncommitted changes
            let isDirty = false;
            let hasCommits = false;
            try {
              const gitStatus = execSync('git status --porcelain', {
                cwd: worktreePath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
              }).trim();
              isDirty = gitStatus.length > 0;

              // Check commits ahead of base
              const baseBranch = agentInfo.worktree.base_branch || 'main';
              const ahead = execSync(`git rev-list --count ${baseBranch}..HEAD`, {
                cwd: worktreePath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
              }).trim();
              hasCommits = parseInt(ahead, 10) > 0;
            } catch { /* ignore */ }

            // Completed agent with work to merge
            if ((status === 'completed' || status === 'reaped') && (isDirty || hasCommits)) {
              if (options.resume) {
                if (!options.json) {
                  console.log(`Resuming ${taskId} with existing work (${isDirty ? 'uncommitted changes' : hasCommits + ' commits'})...`);
                }
                // Continue - reuse worktree
              } else {
                escalate(`Agent ${taskId} has unmerged work`, [
                  `agent:spawn ${taskId} --resume  # Continue with existing work`,
                  `agent:reap ${taskId}            # Merge + cleanup + respawn`,
                  `agent:reject ${taskId}          # Discard work`
                ]);
              }
            }

            // Agent has uncommitted work but didn't complete properly
            if (isDirty && !['completed', 'reaped'].includes(status)) {
              if (options.resume) {
                if (!options.json) {
                  console.log(`Resuming ${taskId} with uncommitted changes (status: ${status})...`);
                }
                // Continue - reuse worktree
              } else {
                escalate(`Agent ${taskId} has uncommitted changes (status: ${status})`, [
                  `agent:spawn ${taskId} --resume  # Continue with existing work`,
                  `agent:reap ${taskId}            # Try to harvest`,
                  `agent:reject ${taskId}          # Discard work`
                ]);
              }
            }

            // Has commits but not merged
            if (hasCommits && !['reaped'].includes(status)) {
              if (options.resume) {
                if (!options.json) {
                  console.log(`Resuming ${taskId} with ${hasCommits} commit(s)...`);
                }
                // Continue - reuse worktree
              } else {
                escalate(`Agent ${taskId} has ${hasCommits} commit(s) not merged`, [
                  `agent:spawn ${taskId} --resume  # Continue with existing work`,
                  `agent:reap ${taskId}            # Merge + cleanup`,
                  `agent:reject ${taskId}          # Discard work`
                ]);
              }
            }

            // Clean worktree, can reuse - auto-cleanup
            if (!isDirty && !hasCommits) {
              if (!options.json) {
                console.log(`Auto-cleaning previous ${taskId} (no changes)...`);
              }
              removeWorktree(taskId, { force: true });
              delete state.agents[taskId];
              saveState(state);
            }
          } else {
            // Worktree doesn't exist, just clear state
            if (!options.json) {
              console.log(`Clearing stale state for ${taskId}...`);
            }
            delete state.agents[taskId];
            saveState(state);
          }
        } else {
          // No worktree mode - clear completed/error states
          if (['completed', 'error', 'reaped', 'rejected'].includes(status)) {
            if (!options.json) {
              console.log(`Clearing previous ${taskId} (${status})...`);
            }
            delete state.agents[taskId];
            saveState(state);
          } else {
            escalate(`Agent ${taskId} in unexpected state: ${status}`, [
              `agent:clear ${taskId}    # Force clear state`
            ]);
          }
        }
      }

      // Determine agent directory
      const agentDir = ensureDir(getAgentDir(taskId));

      // Determine if worktree should be created (agentConfig loaded at function start)
      let useWorktree = agentConfig.use_worktrees;
      if (options.worktree === true) useWorktree = true;
      else if (options.worktree === false) useWorktree = false;

      // Verify git repo and clean state if worktree mode is enabled
      if (useWorktree) {
        const gitOpts = { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };

        // Check git repo exists
        try {
          execSync('git rev-parse --git-dir 2>/dev/null', gitOpts);
        } catch {
          console.error('BLOCKED: use_worktrees requires a git repository\n');
          console.error('Escalate for resolution.');
          process.exit(1);
        }

        // Check for uncommitted changes
        try {
          const status = execSync('git status --porcelain', gitOpts).trim();
          if (status) {
            console.error('BLOCKED: Working directory has uncommitted changes\n');
            console.error('Worktree isolation requires a clean working directory.');
            console.error('Escalate for resolution.\n');
            console.error('Uncommitted files:');
            status.split('\n').slice(0, 10).forEach(line => console.error(`  ${line}`));
            if (status.split('\n').length > 10) {
              console.error(`  ... and ${status.split('\n').length - 10} more`);
            }
            process.exit(1);
          }
        } catch (e) {
          console.error('ERROR: Failed to check git status:', e.message);
          process.exit(1);
        }

        // Check for commits (git worktree requires at least one commit)
        try {
          execSync('git rev-parse HEAD 2>/dev/null', gitOpts);
        } catch {
          console.error('BLOCKED: No commits in repository\n');
          console.error('Git worktree requires at least one commit to create branches.');
          console.error('Escalate for resolution.');
          process.exit(1);
        }
      }

      // Get branching strategy from PRD
      const branching = getPrdBranching(prdId);
      const branchContext = { prdId, epicId, branching };

      // Ensure branch hierarchy exists and sync parent (if enabled)
      if (useWorktree && branching !== 'flat') {
        // 1. First ensure branch hierarchy exists (prd/epic branches)
        const hierarchyResult = ensureBranchHierarchy(branchContext);
        if (!options.json && !options.dryRun && hierarchyResult.created.length > 0) {
          console.log('Created branches:');
          hierarchyResult.created.forEach(b => console.log(`  ${b}`));
        }
        if (hierarchyResult.errors.length > 0) {
          console.error('Branch creation errors:');
          hierarchyResult.errors.forEach(e => console.error(`  ${e}`));
          process.exit(1);
        }

        // 2. Sync parent branch with its upstream (one level only)
        const syncResult = syncParentBranch(branchContext);

        if (!options.json && !options.dryRun) {
          if (syncResult.synced) {
            console.log(`Synced: ${syncResult.synced}`);
          }
          if (syncResult.error) {
            console.error(`Sync error: ${syncResult.error}`);
            console.error('\nResolve conflicts manually or use /dev:merge skill.');
            process.exit(1);
          }
        }
      }

      // Get timeout
      const timeout = options.timeout || agentConfig.timeout || 600;

      // Create mission.yaml for debug/trace
      // In worktree mode, agent must NOT commit (skill handles it)
      // Without worktree, agent must commit before release
      const mission = createMission({
        task_id: taskId,
        epic_id: epicId,
        prd_id: prdId,
        instruction: task.body.trim(),
        dev_md: findDevMd(projectRoot) || '',
        epic_file: findEpicFile(epicId),
        task_file: taskFile,
        memory: findMemoryFile(epicId),
        toolset: findToolset(projectRoot),
        constraints: { no_git_commit: useWorktree },
        timeout
      });
      const missionFile = path.join(agentDir, 'mission.yaml');

      // Build bootstrap prompt - uses MCP rudder tool (not bash)
      // Commit instructions depend on worktree mode:
      // - With worktree: skill handles commits, agent must NOT commit
      // - Without worktree: agent must commit before releasing task
      const commitInstructions = useWorktree
        ? `- **NO git commit** - worktree mode: skill handles commits after review
- Follow the task deliverables exactly
- Log meaningful tips for knowledge transfer`
        : `- **MUST commit before release**: Stage and commit your changes with a clear message before calling assign:release
- Follow the task deliverables exactly
- Log meaningful tips for knowledge transfer
- Use conventional commit format: \`feat(scope): description\` or \`fix(scope): description\``;

      const bootstrapPrompt = `# Agent Bootstrap: ${taskId}

You are an autonomous agent assigned to task ${taskId}.

## MCP Rudder Tool

You have access to a **rudder** MCP tool for all sailing operations. Use it like this:

\`\`\`
Tool: mcp__rudder__cli
Arguments: { "command": "..." }
\`\`\`

**Do NOT use Bash to run \`rudder\` commands.** Use the MCP tool.

## Instructions

1. **Get your context** by calling:
   \`\`\`json
   { "command": "assign:claim ${taskId}" }
   \`\`\`
   This will output your full instructions, memory, and task details.

2. **Execute the task** according to the deliverables.

3. **Log tips** during your work (at least 1):
   \`\`\`json
   { "command": "task:log ${taskId} \\"useful insight for future agents\\" --tip" }
   \`\`\`
   ⚠️ **NEVER create log files** (no .tip-log.txt, no *.log). Use the MCP tool above.

4. **When complete**, call:
   \`\`\`json
   { "command": "assign:release ${taskId}" }
   \`\`\`

## Constraints

${commitInstructions}

Start by calling the rudder MCP tool with \`assign:claim ${taskId}\` to get your instructions.
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
        // Handle orphaned worktree (exists on disk but not in state.json)
        if (worktreeExists(taskId)) {
          const worktreePath = getWorktreePath(taskId);
          const branch = getBranchName(taskId);

          // Check if worktree is clean (reusable)
          let isDirty = false;
          let hasCommits = false;
          const mainBranch = getMainBranch();

          try {
            const gitStatus = execSync('git status --porcelain', {
              cwd: worktreePath,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
            isDirty = gitStatus.length > 0;

            // Check commits ahead of main
            const ahead = execSync(`git rev-list --count ${mainBranch}..HEAD`, {
              cwd: worktreePath,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
            hasCommits = parseInt(ahead, 10) > 0;
          } catch { /* ignore */ }

          if (isDirty || hasCommits) {
            if (options.resume) {
              // Resume mode: reuse existing worktree with work
              if (!options.json) {
                console.log(`Resuming in existing worktree for ${taskId}...`);
                if (isDirty) console.log(`  (has uncommitted changes)`);
                if (hasCommits) console.log(`  (has ${hasCommits} commit(s) ahead of ${mainBranch})`);
              }
              // Use existing worktree - set worktreeInfo and cwd
              worktreeInfo = {
                path: worktreePath,
                branch: branch,
                base_branch: mainBranch,
                branching,
                resumed: true
              };
              cwd = worktreePath;
            } else {
              // Worktree has work that might be lost
              escalate(`Orphaned worktree exists for ${taskId}`, [
                `Path: ${worktreePath}`,
                `Branch: ${branch}`,
                isDirty ? `Has uncommitted changes` : `Has ${hasCommits} commit(s) ahead of ${mainBranch}`,
                ``,
                `Options:`,
                `  agent:spawn ${taskId} --resume  # Continue with existing work`,
                `  agent:sync                      # Recover into state`,
                `  agent:reject ${taskId}          # Discard work`
              ]);
            }
          } else {
            // Clean worktree - auto-cleanup and proceed
            if (!options.json) {
              console.log(`Auto-cleaning orphaned worktree for ${taskId}...`);
            }
            removeWorktree(taskId, { force: true });
          }
        }

        // Create new worktree if not resuming an existing one
        if (!worktreeInfo) {
          // Get parent branch based on branching strategy
          const parentBranch = getParentBranch(taskId, branchContext);

          const result = createWorktree(taskId, { baseBranch: parentBranch });
          if (!result.success) {
            console.error(`Failed to create worktree: ${result.error}`);
            process.exit(1);
          }

          worktreeInfo = {
            path: result.path,
            branch: result.branch,
            base_branch: result.baseBranch,
            branching  // Store strategy for later merge
          };
          cwd = result.path;

          if (!options.json) {
            if (result.reused) {
              console.log(`Worktree created (reusing existing branch): ${result.path}`);
              console.log(`  Branch: ${result.branch} (orphaned, no commits)`);
            } else {
              console.log(`Worktree created: ${result.path}`);
              console.log(`  Branch: ${result.branch} (from ${parentBranch})`);
            }
          }
        }
      }

      // Write mission file (for debug/trace)
      fs.writeFileSync(missionFile, yaml.dump(mission));

      // Get log file path
      const logFile = getLogFilePath(taskId);

      // Spawn Claude with bootstrap prompt
      // Includes MCP config for restricted rudder access (agent can only access its task)
      const spawnResult = await spawnClaude({
        prompt: bootstrapPrompt,
        cwd,
        logFile,
        timeout,
        agentDir,
        taskId,                           // For MCP server task restriction
        projectRoot,                      // For MCP server rudder commands
        stderrToFile: options.stderrToFile
      });

      // Update state atomically to prevent race condition with parallel spawns
      const agentEntry = {
        status: 'spawned',
        spawned_at: new Date().toISOString(),
        pid: spawnResult.pid,
        mission_file: missionFile,
        log_file: spawnResult.logFile,
        srt_config: spawnResult.srtConfig,
        mcp_config: spawnResult.mcpConfig,
        mcp_server: spawnResult.mcpServerPath,
        mcp_port: spawnResult.mcpPort,       // External MCP port (if used)
        mcp_pid: spawnResult.mcpPid,         // External MCP server PID (if used)
        timeout,
        ...(worktreeInfo && { worktree: worktreeInfo })
      };
      updateStateAtomic(s => {
        if (!s.agents) s.agents = {};
        s.agents[taskId] = agentEntry;
        return s;
      });

      // Handle process exit
      spawnResult.process.on('exit', (code, signal) => {
        // Check for uncommitted changes before updating state
        let dirtyWorktree = false;
        let uncommittedFiles = 0;
        try {
          const gitStatus = execSync('git status --porcelain', {
            cwd,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
          }).trim();

          if (gitStatus) {
            dirtyWorktree = true;
            uncommittedFiles = gitStatus.split('\n').length;

            if (!useWorktree) {
              // Non-worktree mode: agent should have committed
              console.error(`\n⚠️  WARNING: Agent ${taskId} left uncommitted changes`);
              console.error(`   ${uncommittedFiles} file(s) modified but not committed.`);
              console.error(`   Agent should have committed before releasing task.\n`);
            }
          }
        } catch (e) {
          // Git check failed, ignore
        }

        // Update state atomically
        const updatedState = updateStateAtomic(s => {
          if (s.agents?.[taskId]) {
            s.agents[taskId].status = code === 0 ? 'completed' : 'error';
            s.agents[taskId].exit_code = code;
            s.agents[taskId].exit_signal = signal;
            s.agents[taskId].ended_at = new Date().toISOString();
            delete s.agents[taskId].pid;
            if (dirtyWorktree) {
              s.agents[taskId].dirty_worktree = true;
              s.agents[taskId].uncommitted_files = uncommittedFiles;
            }
          }
          return s;
        });

        // Auto-create PR if enabled and agent completed successfully
        if (code === 0 && agentConfig.auto_pr && updatedState.agents?.[taskId]?.worktree) {
          try {
            const draftFlag = agentConfig.pr_draft ? '--draft' : '';
            execSync(`${process.argv[0]} ${process.argv[1]} worktree pr ${taskId} ${draftFlag} --json`, {
              cwd: projectRoot,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe']
            });
            console.log(`Auto-PR created for ${taskId}`);
          } catch (e) {
            console.error(`Auto-PR failed for ${taskId}: ${e.message}`);
          }
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

  // agent:wait (DEPRECATED - use agent:reap)
  agent.command('wait <task-id>')
    .description('[DEPRECATED] Wait for agent to complete → use agent:reap instead')
    .option('--timeout <seconds>', 'Timeout in seconds (default: 3600)', parseInt, 3600)
    .option('--interval <seconds>', 'Poll interval in seconds (default: 5)', parseInt, 5)
    .option('--json', 'JSON output')
    .action(async (taskId, options) => {
      console.error('⚠️  DEPRECATED: agent:wait is deprecated. Use agent:reap instead.');
      console.error('   agent:reap waits, merges, cleans up, and updates status.\n');

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

  // agent:collect (DEPRECATED - use agent:reap)
  agent.command('collect <task-id>')
    .description('[DEPRECATED] Collect agent result → use agent:reap instead')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      console.error('⚠️  DEPRECATED: agent:collect is deprecated. Use agent:reap instead.');
      console.error('   agent:reap collects, merges, cleans up, and updates status.\n');

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

  // agent:sync - reconcile state.json with reality (worktrees, agents dirs)
  agent.command('sync')
    .description('Sync state.json with actual worktrees/agents (recover from ghosts)')
    .option('--dry-run', 'Show what would be done without making changes')
    .option('--json', 'JSON output')
    .action((options) => {
      const config = getAgentConfig();
      const havenPath = resolvePlaceholders('${haven}');
      const worktreesDir = path.join(havenPath, 'worktrees');
      const agentsDir = path.join(havenPath, 'agents');

      const state = loadState();
      if (!state.agents) state.agents = {};

      const changes = { added: [], updated: [], orphaned: [] };

      // Scan worktrees directory
      if (fs.existsSync(worktreesDir)) {
        const worktrees = fs.readdirSync(worktreesDir).filter(d =>
          d.startsWith('T') && fs.statSync(path.join(worktreesDir, d)).isDirectory()
        );

        for (const taskId of worktrees) {
          const worktreePath = path.join(worktreesDir, taskId);
          const agentDir = path.join(agentsDir, taskId);
          const missionFile = path.join(agentDir, 'mission.yaml');
          const logFile = path.join(agentDir, 'run.log');

          // Check if agent entry exists in state
          if (!state.agents[taskId]) {
            // Orphaned worktree - create agent entry from reality
            const entry = {
              status: 'orphaned',
              recovered_at: new Date().toISOString(),
              worktree: {
                path: worktreePath,
                branch: `task/${taskId}`
              }
            };

            // Try to get more info from files
            if (fs.existsSync(missionFile)) {
              entry.mission_file = missionFile;
            }
            if (fs.existsSync(logFile)) {
              entry.log_file = logFile;
              // Check if log indicates completion
              try {
                const logContent = fs.readFileSync(logFile, 'utf8');
                if (logContent.includes('exit code: 0') || logContent.includes('Exit code: 0')) {
                  entry.status = 'completed';
                }
              } catch { /* ignore */ }
            }

            // Check for uncommitted changes
            try {
              const gitStatus = execSync('git status --porcelain', {
                cwd: worktreePath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
              }).trim();
              if (gitStatus) {
                entry.dirty_worktree = true;
                entry.uncommitted_files = gitStatus.split('\n').length;
              }
            } catch { /* ignore */ }

            if (!options.dryRun) {
              state.agents[taskId] = entry;
            }
            changes.added.push({ taskId, status: entry.status });
          } else if (state.agents[taskId].status === 'spawned') {
            // Check if process is actually running
            const pid = state.agents[taskId].pid;
            let isRunning = false;
            if (pid) {
              try {
                process.kill(pid, 0);
                isRunning = true;
              } catch { /* not running */ }
            }

            if (!isRunning) {
              // Process died without updating state
              if (!options.dryRun) {
                state.agents[taskId].status = 'orphaned';
                state.agents[taskId].orphaned_at = new Date().toISOString();
                delete state.agents[taskId].pid;
              }
              changes.updated.push({ taskId, from: 'spawned', to: 'orphaned' });
            }
          }
        }
      }

      // Find orphaned entries in state (no worktree exists)
      for (const taskId of Object.keys(state.agents)) {
        const worktreePath = path.join(worktreesDir, taskId);
        if (!fs.existsSync(worktreePath) && state.agents[taskId].worktree) {
          changes.orphaned.push({ taskId, status: state.agents[taskId].status });
        }
      }

      if (!options.dryRun) {
        saveState(state);
      }

      if (options.json) {
        jsonOut({ changes, dry_run: options.dryRun });
      } else {
        const prefix = options.dryRun ? '[DRY-RUN] ' : '';
        if (changes.added.length > 0) {
          console.log(`${prefix}Added ${changes.added.length} orphaned agent(s):`);
          changes.added.forEach(c => console.log(`  + ${c.taskId}: ${c.status}`));
        }
        if (changes.updated.length > 0) {
          console.log(`${prefix}Updated ${changes.updated.length} agent(s):`);
          changes.updated.forEach(c => console.log(`  ~ ${c.taskId}: ${c.from} → ${c.to}`));
        }
        if (changes.orphaned.length > 0) {
          console.log(`${prefix}Orphaned entries (worktree missing):`);
          changes.orphaned.forEach(c => console.log(`  ? ${c.taskId}: ${c.status}`));
        }
        if (changes.added.length === 0 && changes.updated.length === 0 && changes.orphaned.length === 0) {
          console.log('State is in sync with reality');
        }
      }
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

  // agent:reap - unified harvest: wait, collect, merge, cleanup, update status
  agent.command('reap <task-id>')
    .description('Harvest agent work: wait, merge, cleanup, update status (or escalate)')
    .option('--role <role>', 'Role context (skill, coordinator) - agent role blocked')
    .option('--no-wait', 'Skip waiting if agent not complete')
    .option('--timeout <seconds>', 'Wait timeout (default: 300)', parseInt, 300)
    .option('--json', 'JSON output')
    .action(async (taskId, options) => {
      // Role enforcement: agents cannot reap
      if (options.role === 'agent') {
        console.error('ERROR: agent:reap cannot be called with --role agent');
        console.error('Agents cannot harvest. Only skill or coordinator can reap.');
        process.exit(1);
      }

      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const state = loadState();
      const agentInfo = state.agents?.[taskId];
      const projectRoot = findProjectRoot();
      const config = getAgentConfig();

      // Helper for escalation
      const escalate = (reason, nextSteps) => {
        if (options.json) {
          jsonOut({
            task_id: taskId,
            status: 'blocked',
            reason,
            next_steps: nextSteps
          });
        } else {
          console.error(`\nBLOCKED: ${reason}\n`);
          console.error('Next steps:');
          nextSteps.forEach(step => console.error(`  ${step}`));
        }
        process.exit(1);
      };

      // 1. Check agent exists
      if (!agentInfo) {
        escalate(`No agent found for task ${taskId}`, [
          `agent:spawn ${taskId}    # Start agent first`
        ]);
      }

      // 2. Check if still running
      if (agentInfo.pid) {
        try {
          process.kill(agentInfo.pid, 0);
          // Process still running
          if (options.wait === false) {
            escalate(`Agent ${taskId} is still running (PID ${agentInfo.pid})`, [
              `agent:wait ${taskId}     # Wait for completion`,
              `agent:kill ${taskId}     # Force terminate`
            ]);
          }
          // Wait for completion
          if (!options.json) {
            console.log(`Waiting for ${taskId} (timeout: ${options.timeout}s)...`);
          }
          const startTime = Date.now();
          const timeoutMs = options.timeout * 1000;
          while (true) {
            const completion = checkAgentCompletion(taskId);
            if (completion.complete) break;
            if (Date.now() - startTime > timeoutMs) {
              escalate(`Timeout waiting for agent ${taskId}`, [
                `agent:wait ${taskId} --timeout 3600    # Wait longer`,
                `agent:kill ${taskId}                   # Force terminate`
              ]);
            }
            await new Promise(r => setTimeout(r, 5000));
            if (!options.json) process.stdout.write('.');
          }
          if (!options.json) console.log(' done');
        } catch {
          // Process not running, continue
        }
      }

      // 3. Check completion
      const completion = checkAgentCompletion(taskId);
      if (!completion.complete) {
        escalate(`Agent ${taskId} did not complete`, [
          `agent:status ${taskId}    # Check status`,
          `agent:reject ${taskId}    # Discard incomplete work`
        ]);
      }

      // 4. Determine result status
      let resultStatus = 'completed';
      const agentDir = getAgentDir(taskId);
      const resultFile = path.join(agentDir, 'result.yaml');
      if (fs.existsSync(resultFile)) {
        try {
          const result = yaml.load(fs.readFileSync(resultFile, 'utf8'));
          resultStatus = result.status || 'completed';
        } catch { /* ignore */ }
      }

      // 5. Handle worktree mode
      if (agentInfo.worktree) {
        const worktreePath = agentInfo.worktree.path;
        const branch = agentInfo.worktree.branch;

        if (!fs.existsSync(worktreePath)) {
          escalate(`Worktree not found: ${worktreePath}`, [
            `agent:clear ${taskId}    # Clear stale state`
          ]);
        }

        // 5a. Auto-commit if dirty
        try {
          const gitStatus = execSync('git status --porcelain', {
            cwd: worktreePath,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
          }).trim();

          if (gitStatus) {
            if (!options.json) {
              console.log(`⚠️  Auto-committing ${gitStatus.split('\n').length} uncommitted file(s)`);
            }
            execSync('git add -A', { cwd: worktreePath, stdio: 'pipe' });
            execSync(`git commit -m "chore(${taskId}): auto-commit agent changes"`, {
              cwd: worktreePath,
              stdio: 'pipe'
            });
          }
        } catch (e) {
          // Commit failed or nothing to commit
        }

        // 5b. Check for conflicts
        try {
          const mergeBase = execSync(`git merge-base HEAD ${branch}`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
          }).trim();

          const mergeTree = execSync(`git merge-tree ${mergeBase} HEAD ${branch}`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
          });

          if (mergeTree.includes('<<<<<<<') || mergeTree.includes('>>>>>>>')) {
            // Extract conflicting files
            const conflictFiles = [];
            const lines = mergeTree.split('\n');
            for (const line of lines) {
              if (line.startsWith('changed in both')) {
                const match = line.match(/changed in both\s+(.+)/);
                if (match) conflictFiles.push(match[1]);
              }
            }

            escalate(`Merge conflicts detected`, [
              `/dev:merge ${taskId}                           # Guided conflict resolution`,
              ``,
              `Manual resolution:`,
              `  git checkout -b merge/${taskId}-to-main main`,
              `  git merge ${branch} --no-commit`,
              `  # ... resolve conflicts ...`,
              `  git commit -m "merge(${taskId}): resolved conflicts"`,
              `  git checkout main && git merge merge/${taskId}-to-main --ff-only`,
              `  agent:clear ${taskId}`,
              ...(conflictFiles.length > 0 ? [``, `Conflicting files:`, ...conflictFiles.map(f => `  ${f}`)] : [])
            ]);
          }
        } catch (e) {
          escalate(`Cannot check merge status: ${e.message}`, [
            `git fetch origin`,
            `agent:reap ${taskId}    # Retry`
          ]);
        }

        // 5c. Merge (no conflicts)
        const strategy = config.merge_strategy || 'merge';
        try {
          if (!options.json) {
            console.log(`Merging ${branch} → main (${strategy})...`);
          }

          if (strategy === 'squash') {
            execSync(`git merge --squash ${branch}`, { cwd: projectRoot, stdio: 'pipe' });
            execSync(`git commit -m "feat(${taskId}): ${agentInfo.worktree.branch}"`, {
              cwd: projectRoot,
              stdio: 'pipe'
            });
          } else if (strategy === 'rebase') {
            execSync(`git rebase ${branch}`, { cwd: projectRoot, stdio: 'pipe' });
          } else {
            execSync(`git merge ${branch} --no-edit`, { cwd: projectRoot, stdio: 'pipe' });
          }
        } catch (e) {
          escalate(`Merge failed: ${e.message}`, [
            `/dev:merge ${taskId}    # Manual resolution`
          ]);
        }

        // 5d. Cleanup worktree
        const removeResult = removeWorktree(taskId, { force: true });
        if (!options.json && !removeResult.success) {
          console.error(`Warning: Failed to cleanup worktree: ${removeResult.error}`);
        }

        if (!options.json) {
          console.log(`✓ Merged and cleaned up ${taskId}`);
        }
      }

      // 6. Update task status
      const taskStatus = resultStatus === 'completed' ? 'Done' : 'Blocked';
      try {
        execSync(`${process.argv[0]} ${process.argv[1]} task:update ${taskId} --status "${taskStatus}"`, {
          cwd: projectRoot,
          encoding: 'utf8',
          stdio: 'pipe'
        });
        if (!options.json) {
          console.log(`✓ Task ${taskId} → ${taskStatus}`);
        }
      } catch (e) {
        if (!options.json) {
          console.error(`Warning: Could not update task status: ${e.message}`);
        }
      }

      // 7. Update agent state
      state.agents[taskId] = {
        ...agentInfo,
        status: 'reaped',
        result_status: resultStatus,
        reaped_at: new Date().toISOString()
      };
      saveState(state);

      if (options.json) {
        jsonOut({
          task_id: taskId,
          status: 'success',
          result_status: resultStatus,
          task_status: taskStatus,
          merged: !!agentInfo.worktree,
          cleaned_up: !!agentInfo.worktree
        });
      }
    });

  // agent:merge (DEPRECATED - use agent:reap)
  agent.command('merge <task-id>')
    .description('[DEPRECATED] Merge agent worktree → use agent:reap instead')
    .option('--strategy <type>', 'Merge strategy: merge|squash|rebase (default from config)')
    .option('--no-cleanup', 'Keep worktree after merge')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      console.error('⚠️  DEPRECATED: agent:merge is deprecated. Use agent:reap instead.');
      console.error('   agent:reap handles merge, cleanup, and status update.\n');

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
