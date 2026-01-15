/**
 * Agent spawn command
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { findProjectRoot, loadFile, jsonOut } from '../../lib/core.js';
import { execRudderSafe } from '../../lib/invoke.js';
import { getGit } from '../../lib/git.js';
import { resolvePlaceholders } from '../../lib/paths.js';
import { createMission } from '../../lib/agent-schema.js';
import { loadState, saveState, updateStateAtomic } from '../../lib/state.js';
import { withModifies } from '../../lib/help.js';
import { getAgentConfig } from '../../lib/config.js';
import { buildAgentSpawnPrompt } from '../../lib/compose.js';
import { createWorktree, getWorktreePath, getBranchName, worktreeExists, removeWorktree, ensureBranchHierarchy, syncParentBranch, getParentBranch, getMainBranch } from '../../lib/worktree.js';
import { spawnClaude, getLogFilePath } from '../../lib/claude.js';
import { checkMcpServer } from '../../lib/srt.js';
import { extractPrdId, extractEpicId, getPrdBranching, findDevMd, findToolset } from '../../lib/entities.js';
import { getTask, getEpic, getMemoryFile } from '../../lib/index.js';
import { normalizeId } from '../../lib/normalize.js';
import { getAgentDir, getProcessStats, formatDuration } from '../../lib/agent-utils.js';
import { ensureDir } from '../../lib/paths.js';
import { analyzeLog, printDiagnoseResult } from '../../lib/diagnose.js';
export function registerSpawnCommand(agent) {
    withModifies(agent.command('spawn <task-id>'), ['task', 'git', 'state'])
        .description('Spawn agent to execute task (creates worktree, spawns Claude)')
        .option('--role <role>', 'Role context (skill, coordinator) - agent role blocked')
        .option('--timeout <seconds>', 'Execution timeout (default: 600)', parseInt)
        .option('--worktree', 'Create isolated worktree (overrides config)')
        .option('--no-worktree', 'Skip worktree creation (overrides config)')
        .option('--no-wait', 'Fire and forget (do not wait for completion)')
        .option('--no-log', 'Do not stream Claude stdout/stderr')
        .option('--no-heartbeat', 'Do not show periodic heartbeat')
        .option('--heartbeat <seconds>', 'Heartbeat interval (default: 60 quiet, 30 verbose)', parseInt)
        .option('-v, --verbose', 'Detailed output (spawn box, Claude streaming)')
        .option('--resume', 'Reuse existing worktree (continue blocked/partial work)')
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
        taskId = normalizeId(taskId);
        // Find task file
        const taskFile = getTask(taskId)?.file;
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
        if (!state.agents)
            state.agents = {};
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
            }
            else {
                console.error(`\nBLOCKED: ${reason}\n`);
                console.error('Next steps:');
                nextSteps.forEach(step => console.error(`  ${step}`));
            }
            process.exit(1);
        };
        // Check MCP server is running (required for sandbox agents)
        const havenDir = resolvePlaceholders('${haven}');
        const mcpStatus = checkMcpServer(havenDir);
        if (!mcpStatus.running) {
            escalate('MCP server not running', [
                `bin/rudder-mcp start     # Start the MCP server`,
                `bin/rudder-mcp status    # Check server status`
            ]);
        }
        if (state.agents[taskId]) {
            const agentInfo = state.agents[taskId];
            const status = agentInfo.status;
            // Check if process is actually running
            let isRunning = false;
            if (agentInfo.pid) {
                try {
                    process.kill(agentInfo.pid, 0);
                    isRunning = true;
                }
                catch { /* not running */ }
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
                    // Check for uncommitted changes and commits ahead
                    const baseBranch = agentInfo.worktree.base_branch || 'main';
                    const worktreeGit = getGit(worktreePath);
                    const worktreeStatus = await worktreeGit.status();
                    const isDirty = !worktreeStatus.isClean();
                    const worktreeLog = await worktreeGit.log({ from: baseBranch, to: 'HEAD' });
                    const commitsAhead = worktreeLog.total;
                    // Completed agent with work to merge
                    if ((status === 'completed' || status === 'reaped') && (isDirty || commitsAhead > 0)) {
                        if (options.resume) {
                            if (!options.json) {
                                console.log(`Resuming ${taskId} with existing work (${isDirty ? 'uncommitted changes' : commitsAhead + ' commits'})...`);
                            }
                            // Continue - reuse worktree
                        }
                        else {
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
                        }
                        else {
                            escalate(`Agent ${taskId} has uncommitted changes (status: ${status})`, [
                                `agent:spawn ${taskId} --resume  # Continue with existing work`,
                                `agent:reap ${taskId}            # Try to harvest`,
                                `agent:reject ${taskId}          # Discard work`
                            ]);
                        }
                    }
                    // Has commits but not merged
                    if (commitsAhead > 0 && !['reaped'].includes(status)) {
                        if (options.resume) {
                            if (!options.json) {
                                console.log(`Resuming ${taskId} with ${commitsAhead} commit(s)...`);
                            }
                            // Continue - reuse worktree
                        }
                        else {
                            escalate(`Agent ${taskId} has ${commitsAhead} commit(s) not merged`, [
                                `agent:spawn ${taskId} --resume  # Continue with existing work`,
                                `agent:reap ${taskId}            # Merge + cleanup`,
                                `agent:reject ${taskId}          # Discard work`
                            ]);
                        }
                    }
                    // Clean worktree, can reuse - auto-cleanup
                    if (!isDirty && commitsAhead === 0) {
                        if (!options.json) {
                            console.log(`Auto-cleaning previous ${taskId} (no changes)...`);
                        }
                        removeWorktree(taskId, { force: true });
                        delete state.agents[taskId];
                        saveState(state);
                    }
                }
                else {
                    // Worktree doesn't exist, just clear state
                    if (!options.json) {
                        console.log(`Clearing stale state for ${taskId}...`);
                    }
                    delete state.agents[taskId];
                    saveState(state);
                }
            }
            else {
                // No worktree mode - clear completed/error states
                if (['completed', 'error', 'reaped', 'rejected'].includes(status)) {
                    if (!options.json) {
                        console.log(`Clearing previous ${taskId} (${status})...`);
                    }
                    delete state.agents[taskId];
                    saveState(state);
                }
                else {
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
        if (options.worktree === true)
            useWorktree = true;
        else if (options.worktree === false)
            useWorktree = false;
        // Verify git repo and clean state if worktree mode is enabled
        if (useWorktree) {
            const git = getGit(projectRoot);
            // Check git repo exists
            const isRepo = await git.checkIsRepo();
            if (!isRepo) {
                console.error('BLOCKED: use_worktrees requires a git repository\n');
                console.error('Escalate for resolution.');
                process.exit(1);
            }
            // Check for uncommitted changes
            const gitStatus = await git.status();
            if (!gitStatus.isClean()) {
                console.error('BLOCKED: Working directory has uncommitted changes\n');
                console.error('Worktree isolation requires a clean working directory.');
                console.error('Escalate for resolution.\n');
                console.error('Uncommitted files:');
                const allFiles = [...gitStatus.modified, ...gitStatus.created, ...gitStatus.deleted, ...gitStatus.not_added];
                allFiles.slice(0, 10).forEach(file => console.error(`  ${file}`));
                if (allFiles.length > 10) {
                    console.error(`  ... and ${allFiles.length - 10} more`);
                }
                process.exit(1);
            }
            // Check for commits (git worktree requires at least one commit)
            const repoLog = await git.log().catch(() => ({ total: 0 }));
            if (repoLog.total === 0) {
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
        const mission = createMission({
            task_id: taskId,
            epic_id: epicId,
            prd_id: prdId,
            instruction: task.body.trim(),
            dev_md: findDevMd(projectRoot) || '',
            epic_file: getEpic(epicId)?.file || null,
            task_file: taskFile,
            memory: getMemoryFile(epicId)?.file || null,
            toolset: findToolset(projectRoot),
            constraints: { no_git_commit: useWorktree },
            timeout
        });
        const missionFile = path.join(agentDir, 'mission.yaml');
        // Build bootstrap prompt using shared function (DRY)
        const promptResult = buildAgentSpawnPrompt(taskId, { useWorktree });
        if (!promptResult) {
            console.error(`Error: Failed to build prompt for task ${taskId}`);
            process.exit(1);
        }
        const bootstrapPrompt = promptResult.prompt;
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
                const mainBranch = getMainBranch();
                // Check if worktree is clean (reusable)
                const wtGit = getGit(worktreePath);
                const wtStatus = await wtGit.status();
                const isDirty = !wtStatus.isClean();
                const wtLog = await wtGit.log({ from: mainBranch, to: 'HEAD' });
                const commitsAhead = wtLog.total;
                if (isDirty || commitsAhead > 0) {
                    if (options.resume) {
                        // Resume mode: reuse existing worktree with work
                        if (!options.json) {
                            console.log(`Resuming in existing worktree for ${taskId}...`);
                            if (isDirty)
                                console.log(`  (has uncommitted changes)`);
                            if (commitsAhead > 0)
                                console.log(`  (has ${commitsAhead} commit(s) ahead of ${mainBranch})`);
                        }
                        worktreeInfo = {
                            path: worktreePath,
                            branch: branch,
                            base_branch: mainBranch,
                            branching,
                            resumed: true
                        };
                        cwd = worktreePath;
                    }
                    else {
                        escalate(`Orphaned worktree exists for ${taskId}`, [
                            `Path: ${worktreePath}`,
                            `Branch: ${branch}`,
                            isDirty ? `Has uncommitted changes` : `Has ${commitsAhead} commit(s) ahead of ${mainBranch}`,
                            ``,
                            `Options:`,
                            `  agent:spawn ${taskId} --resume  # Continue with existing work`,
                            `  agent:sync                      # Recover into state`,
                            `  agent:reject ${taskId}          # Discard work`
                        ]);
                    }
                }
                else {
                    // Clean worktree - auto-cleanup and proceed
                    if (!options.json) {
                        console.log(`Auto-cleaning orphaned worktree for ${taskId}...`);
                    }
                    removeWorktree(taskId, { force: true });
                }
            }
            // Create new worktree if not resuming an existing one
            if (!worktreeInfo) {
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
                    branching
                };
                cwd = result.path;
                if (!options.json) {
                    if (result.reused) {
                        console.log(`Worktree created (reusing existing branch): ${result.path}`);
                        console.log(`  Branch: ${result.branch} (orphaned, no commits)`);
                    }
                    else {
                        console.log(`Worktree created: ${result.path}`);
                        console.log(`  Branch: ${result.branch} (from ${parentBranch})`);
                    }
                }
            }
        }
        // Pre-claim task before spawning agent
        {
            const { stderr, exitCode } = execRudderSafe(`assign:claim ${taskId} --role agent --json`, { cwd: projectRoot });
            if (exitCode === 0) {
                if (!options.json) {
                    console.log(`Task ${taskId} claimed`);
                }
            }
            else if (stderr.includes('already claimed')) {
                if (!options.json) {
                    console.log(`Task ${taskId} resuming (already claimed)`);
                }
            }
            else if (stderr) {
                console.error(`Warning: Claim issue: ${stderr}`);
            }
        }
        // Write mission file (for debug/trace)
        fs.writeFileSync(missionFile, yaml.dump(mission));
        // Get log file path
        const logFile = getLogFilePath(taskId);
        // Spawn Claude with bootstrap prompt
        const shouldWait = options.wait !== false;
        const isQuiet = options.verbose !== true;
        const shouldLog = options.log !== false && shouldWait && !isQuiet;
        const spawnResult = await spawnClaude({
            prompt: bootstrapPrompt,
            cwd,
            logFile,
            timeout,
            agentDir,
            taskId,
            projectRoot,
            quietMode: !shouldLog
        });
        // Update state atomically
        const agentEntry = {
            status: 'spawned',
            spawned_at: new Date().toISOString(),
            pid: spawnResult.pid,
            mission_file: missionFile,
            log_file: spawnResult.logFile,
            srt_config: spawnResult.srtConfig,
            mcp_config: spawnResult.mcpConfig,
            mcp_server: spawnResult.mcpServerPath || undefined,
            mcp_port: spawnResult.mcpPort ?? undefined,
            mcp_pid: spawnResult.mcpPid,
            timeout,
            ...(worktreeInfo && { worktree: worktreeInfo })
        };
        updateStateAtomic(s => {
            if (!s.agents)
                s.agents = {};
            s.agents[taskId] = agentEntry;
            return s;
        });
        // Handle process exit
        spawnResult.process.on('exit', async (code, signal) => {
            const exitGit = getGit(cwd);
            const gitStatusResult = await exitGit.status();
            const dirtyWorktree = !gitStatusResult.isClean();
            const allModified = [...gitStatusResult.modified, ...gitStatusResult.created, ...gitStatusResult.deleted, ...gitStatusResult.not_added];
            const uncommittedFiles = allModified.length;
            if (dirtyWorktree && !useWorktree) {
                console.error(`\n⚠️  WARNING: Agent ${taskId} left uncommitted changes`);
                console.error(`   ${uncommittedFiles} file(s) modified but not committed.`);
                console.error(`   Agent should have committed before releasing task.\n`);
            }
            let commitsAhead = 0;
            if (useWorktree && worktreeInfo?.base_branch) {
                const exitLog = await exitGit.log({ from: worktreeInfo.base_branch, to: 'HEAD' });
                commitsAhead = exitLog.total;
            }
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
            // Auto-release if agent exited successfully with work done
            if (code === 0 && (dirtyWorktree || commitsAhead > 0)) {
                const { stdout, stderr, exitCode } = execRudderSafe(`assign:release ${taskId} --json`, { cwd: projectRoot });
                if (exitCode === 0) {
                    console.log(`✓ Auto-released ${taskId} (agent didn't call assign:release)`);
                }
                else if (!stderr.includes('not claimed') && !stdout.includes('not claimed')) {
                    console.error(`⚠ Auto-release failed for ${taskId}: ${stderr}`);
                }
            }
            // Auto-create PR if enabled and agent completed successfully
            if (code === 0 && agentConfig.auto_pr && updatedState.agents?.[taskId]?.worktree) {
                const draftFlag = agentConfig.pr_draft ? '--draft' : '';
                const { stderr, exitCode } = execRudderSafe(`worktree pr ${taskId} ${draftFlag} --json`, { cwd: projectRoot });
                if (exitCode === 0) {
                    console.log(`Auto-PR created for ${taskId}`);
                }
                else {
                    console.error(`Auto-PR failed for ${taskId}: ${stderr}`);
                }
            }
            // Auto-diagnose after agent run
            if (agentConfig.auto_diagnose !== false) {
                const diagLogFile = path.join(getAgentDir(taskId), 'run.jsonlog');
                if (fs.existsSync(diagLogFile)) {
                    const result = analyzeLog(diagLogFile, epicId);
                    if (result.errors.length > 0) {
                        console.log(`\n--- Diagnostic Report ---`);
                        printDiagnoseResult(taskId, result);
                        console.log(`\n🛑 STOP - Action required:`);
                        console.log(`  • If noise: rudder agent:log-noise-add-filter <id> ${taskId} --contains "pattern"`);
                        console.log(`  • If real issue: escalate and fix the sandbox/environment problem`);
                    }
                }
            }
        });
        // === NO-WAIT MODE: fire and forget ===
        if (!shouldWait) {
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
            }
            else {
                console.log(`Spawned: ${taskId}`);
                console.log(`  PID: ${spawnResult.pid}`);
                console.log(`  Timeout: ${timeout}s`);
                console.log(`\nMonitor:`);
                console.log(`  bin/rudder agent:status ${taskId}   # Check if running/complete`);
                console.log(`  bin/rudder agent:log ${taskId} --tail   # Follow output (Ctrl+C to stop)`);
                console.log(`  bin/rudder agent:log ${taskId}          # Show full log`);
                console.log(`\nAfter completion:`);
                console.log(`  bin/rudder agent:reap ${taskId}     # Merge work + cleanup`);
            }
            return;
        }
        // === WAIT MODE (default): wait with heartbeat, auto-reap ===
        const startTime = Date.now();
        const defaultHeartbeat = isQuiet ? 60 : 30;
        const heartbeatSec = typeof options.heartbeat === 'number' ? options.heartbeat : defaultHeartbeat;
        const heartbeatInterval = heartbeatSec * 1000;
        const shouldHeartbeat = options.heartbeat !== false;
        let lastHeartbeat = startTime;
        let detached = false;
        let exitCode = null;
        let exitSignal = null;
        if (!options.json) {
            if (isQuiet) {
                console.log(`${taskId}: spawned (heartbeat every ${heartbeatSec}s)`);
            }
            else {
                const budgetStr = agentConfig.max_budget_usd > 0 ? `$${agentConfig.max_budget_usd}` : 'unlimited';
                const watchdogStr = agentConfig.watchdog_timeout > 0 ? `${agentConfig.watchdog_timeout}s` : 'disabled';
                console.log(`\n┌─ Spawned: ${taskId} ─────────────────────────────────────`);
                console.log(`│ PID: ${spawnResult.pid}`);
                console.log(`│ Mode: ${useWorktree ? 'worktree (isolated branch)' : 'direct'}`);
                if (worktreeInfo) {
                    console.log(`│ Branch: ${worktreeInfo.branch}`);
                }
                console.log(`│ Timeout: ${timeout}s | Budget: ${budgetStr} | Watchdog: ${watchdogStr}`);
                console.log(`├─ Logging ────────────────────────────────────────────────`);
                console.log(`│ • stdout: filtered [INIT] [TOOL] [RESULT] [TEXT] [DONE]`);
                console.log(`│ • .log:     ${spawnResult.logFile || 'none'}`);
                console.log(`│ • .jsonlog: ${spawnResult.jsonLogFile || 'none'}`);
                console.log(`│ • Output = activity (watchdog resets, agent not stale)`);
                console.log(`├─ Behavior ───────────────────────────────────────────────`);
                console.log(`│ • Streaming Claude output${shouldLog ? '' : ' (disabled)'}`);
                console.log(`│ • Heartbeat every ${heartbeatSec}s${shouldHeartbeat ? '' : ' (disabled)'}`);
                console.log(`│ • Auto-reap on success (merge + cleanup + status update)`);
                console.log(`├─ Signals ────────────────────────────────────────────────`);
                console.log(`│ • Ctrl+C: detach (agent continues in background)`);
                console.log(`│ • kill -HUP ${process.pid}: force status check`);
                console.log(`└──────────────────────────────────────────────────────────\n`);
            }
        }
        // Setup SIGHUP handler: force immediate heartbeat
        const emitHeartbeat = () => {
            const elapsed = Date.now() - startTime;
            const stats = getProcessStats(spawnResult.pid);
            if (isQuiet) {
                console.log(`${taskId}: running... ${formatDuration(elapsed)}`);
            }
            else {
                const memInfo = stats.mem ? ` (mem: ${stats.mem})` : '';
                console.log(`[${formatDuration(elapsed)}] pong — ${taskId} ${stats.running ? 'running' : 'stopped'}${memInfo}`);
            }
            lastHeartbeat = Date.now();
        };
        const sighupHandler = () => {
            emitHeartbeat();
        };
        process.on('SIGHUP', sighupHandler);
        // Setup SIGINT handler: detach instead of kill
        const sigintHandler = () => {
            if (!options.json) {
                console.log(`\n\nDetaching from ${taskId} (agent continues in background)`);
                console.log(`Monitor: bin/rudder agent:log ${taskId} --tail`);
                console.log(`Reap:    bin/rudder agent:reap ${taskId}`);
            }
            detached = true;
            cleanup();
            process.exit(0);
        };
        process.on('SIGINT', sigintHandler);
        // Setup SIGTERM handler: kill agent and exit
        const sigtermHandler = () => {
            if (!options.json) {
                console.log(`\nReceived SIGTERM, killing agent ${taskId}...`);
            }
            try {
                process.kill(spawnResult.pid, 'SIGTERM');
            }
            catch { /* ignore */ }
            cleanup();
            process.exit(1);
        };
        process.on('SIGTERM', sigtermHandler);
        // Cleanup signal handlers
        let heartbeatTimer = null;
        const cleanup = () => {
            process.off('SIGHUP', sighupHandler);
            process.off('SIGINT', sigintHandler);
            process.off('SIGTERM', sigtermHandler);
            if (heartbeatTimer)
                clearInterval(heartbeatTimer);
        };
        // Heartbeat timer
        if (shouldHeartbeat && !options.json) {
            heartbeatTimer = setInterval(() => {
                emitHeartbeat();
            }, heartbeatInterval);
        }
        // Wait for process to exit
        await new Promise((resolve) => {
            spawnResult.process.on('exit', (code, signal) => {
                exitCode = code;
                exitSignal = signal;
                resolve();
            });
        });
        cleanup();
        const elapsed = Date.now() - startTime;
        if (options.json) {
            jsonOut({
                task_id: taskId,
                status: exitCode === 0 ? 'completed' : 'error',
                exit_code: exitCode,
                exit_signal: exitSignal,
                elapsed_ms: elapsed,
                ...(worktreeInfo && { worktree: worktreeInfo })
            });
            return;
        }
        if (isQuiet) {
            if (exitCode === 0) {
                console.log(`${taskId}: ✓ completed (${formatDuration(elapsed)})`);
            }
            else {
                console.log(`${taskId}: ✗ failed (exit: ${exitCode}, ${formatDuration(elapsed)})`);
            }
        }
        else {
            console.log('─'.repeat(60));
            if (exitCode === 0) {
                console.log(`✓ ${taskId} completed (${formatDuration(elapsed)})`);
            }
            else {
                console.log(`✗ ${taskId} failed (exit: ${exitCode}, ${formatDuration(elapsed)})`);
            }
        }
        // Auto-reap if successful
        if (exitCode === 0) {
            if (!isQuiet)
                console.log(`\nAuto-reaping ${taskId}...`);
            const { stdout, stderr, exitCode: reapCode } = execRudderSafe(`agent:reap ${taskId}${!isQuiet ? ' --verbose' : ''}`, { cwd: projectRoot });
            if (reapCode === 0) {
                if (!isQuiet && stdout)
                    console.log(stdout);
                if (isQuiet)
                    console.log(`${taskId}: ✓ reaped`);
            }
            else {
                console.error(`Reap failed: ${stderr}`);
                console.error(`Manual: bin/rudder agent:reap ${taskId}`);
            }
        }
        else {
            if (!isQuiet) {
                console.log(`\nNext steps:`);
                console.log(`  bin/rudder agent:log ${taskId}     # Check full log`);
                console.log(`  bin/rudder agent:reject ${taskId}  # Discard work`);
            }
        }
    });
}
