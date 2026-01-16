/**
 * Agent monitor commands: status, list, wait, wait-all, log
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { findProjectRoot, jsonOut, getAgentsDir, getWorktreesDir } from '../../managers/core-manager.js';
import { loadState } from '../../managers/state-manager.js';
import { getAgentLifecycle } from '../../managers/agent-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import {
  AgentUtils, getProcessStats, formatDuration,
  type AgentCompletionInfo
} from '../../lib/agent-utils.js';
import { WorktreeOps } from '../../lib/worktree.js';
import { AgentInfo } from '../../lib/types/agent.js';
import { getWorktreePath } from '../../managers/worktree-manager.js';
import { diagnoseWorktreeState } from '../../lib/state-machine/index.js';
import { getTaskEpic } from '../../managers/artefacts-manager.js';
import {
  getDiagnoseOps, matchesNoiseFilter, parseJsonLog
} from '../../managers/diagnose-manager.js';
import { summarizeEvent } from './diagnose.js';

// ============================================================================
// Log Tailing Helpers
// ============================================================================

export interface LogTailOptions {
  events?: boolean;      // Use jsonlog instead of raw log
  raw?: boolean;         // With events: output raw JSON lines (no summarizing)
  lines?: number;        // Number of recent lines to show
}

export interface LogTailerResult {
  watcher: fs.FSWatcher;
  cleanup: () => void;
}

/**
 * Show recent lines from a text log file
 */
export function showRecentTextLog(logFile: string, lines: number = 20): void {
  if (!fs.existsSync(logFile)) return;
  const content = fs.readFileSync(logFile, 'utf8');
  const allLines = content.split('\n');
  const recentLines = allLines.slice(-lines).join('\n');
  if (recentLines.trim()) {
    console.log('[...recent output...]\n');
    console.log(recentLines);
  }
}

/**
 * Show recent events from a jsonlog file
 * @param rawOutput - If true, output raw JSON lines without parsing/summarizing
 */
export function showRecentJsonLog(
  jsonLogFile: string,
  lines: number = 20,
  noiseFilters: any[] = [],
  rawOutput: boolean = false
): void {
  if (!fs.existsSync(jsonLogFile)) return;

  if (rawOutput) {
    // Raw mode: just output the last N lines as-is
    const content = fs.readFileSync(jsonLogFile, 'utf8');
    const allLines = content.split('\n').filter(l => l.trim());
    const recentLines = allLines.slice(-lines);
    for (const line of recentLines) {
      console.log(line);
    }
    return;
  }

  const { events, lines: rawLines } = parseJsonLog(jsonLogFile);
  const recentEvents = events.slice(-lines);
  const recentRawLines = rawLines.slice(-lines);

  let shown = 0;
  for (let i = 0; i < recentEvents.length; i++) {
    const event = recentEvents[i];
    const line = recentRawLines[i];
    let isNoise = false;
    for (const filter of noiseFilters) {
      if (matchesNoiseFilter(line, event, filter)) {
        isNoise = true;
        break;
      }
    }
    if (!isNoise) {
      console.log(summarizeEvent(event, line));
      shown++;
    }
  }
  if (shown > 0) {
    console.log(''); // blank line after recent events
  }
}

/**
 * Create a watcher for text log file tailing
 */
export function createTextLogTailer(logFile: string): LogTailerResult {
  let lastSize = fs.statSync(logFile).size;

  const watcher = fs.watch(logFile, (eventType) => {
    if (eventType === 'change') {
      try {
        const newSize = fs.statSync(logFile).size;
        if (newSize > lastSize) {
          const fd = fs.openSync(logFile, 'r');
          const buffer = Buffer.alloc(newSize - lastSize);
          fs.readSync(fd, buffer, 0, buffer.length, lastSize);
          fs.closeSync(fd);
          process.stdout.write(buffer.toString());
          lastSize = newSize;
        }
      } catch { /* ignore */ }
    }
  });

  return {
    watcher,
    cleanup: () => watcher.close()
  };
}

/**
 * Create a watcher for jsonlog file tailing with noise filtering
 * @param rawOutput - If true, output raw JSON lines without parsing/summarizing
 */
export function createJsonLogTailer(
  jsonLogFile: string,
  noiseFilters: any[] = [],
  rawOutput: boolean = false
): LogTailerResult {
  let lastSize = fs.statSync(jsonLogFile).size;
  let buffer = '';

  const watcher = fs.watch(jsonLogFile, (eventType) => {
    if (eventType === 'change') {
      try {
        const newSize = fs.statSync(jsonLogFile).size;
        if (newSize > lastSize) {
          const fd = fs.openSync(jsonLogFile, 'r');
          const readBuffer = Buffer.alloc(newSize - lastSize);
          fs.readSync(fd, readBuffer, 0, readBuffer.length, lastSize);
          fs.closeSync(fd);
          buffer += readBuffer.toString();
          lastSize = newSize;

          // Process complete lines
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            if (line.trim()) {
              if (rawOutput) {
                // Raw mode: output line as-is
                console.log(line);
              } else {
                try {
                  const event = JSON.parse(line);
                  let isNoise = false;
                  for (const filter of noiseFilters) {
                    if (matchesNoiseFilter(line, event, filter)) {
                      isNoise = true;
                      break;
                    }
                  }
                  if (!isNoise) {
                    console.log(summarizeEvent(event, line));
                  }
                } catch { /* ignore parse errors */ }
              }
            }
          }
        }
      } catch { /* ignore */ }
    }
  });

  return {
    watcher,
    cleanup: () => watcher.close()
  };
}

/**
 * Setup log tailing for an agent (used by agent:wait and agent:log --tail)
 * Returns cleanup function and watcher
 */
export function setupAgentLogTail(
  taskId: string,
  agentDir: string,
  logFile: string,
  options: LogTailOptions
): LogTailerResult | null {
  const useEvents = options.events ?? false;
  const useRaw = options.raw ?? false;
  const rawJsonOutput = useEvents && useRaw;  // --events --raw = raw JSON lines
  const lines = options.lines ?? 20;

  if (useEvents) {
    const jsonLogFile = path.join(agentDir, 'run.jsonlog');
    if (!fs.existsSync(jsonLogFile)) {
      console.error(`JSON log file not found: ${jsonLogFile}`);
      return null;
    }

    // Load noise filters (not used in raw JSON mode)
    const taskEpic = getTaskEpic(taskId);
    const epicId = taskEpic?.epicId || null;
    const noiseFilters = (useRaw || rawJsonOutput) ? [] : getDiagnoseOps().loadNoiseFilters(epicId);

    // Show recent events
    showRecentJsonLog(jsonLogFile, lines, noiseFilters, rawJsonOutput);

    // Create tailer
    return createJsonLogTailer(jsonLogFile, noiseFilters, rawJsonOutput);
  } else {
    if (!fs.existsSync(logFile)) {
      return null;
    }

    // Show recent lines
    showRecentTextLog(logFile, lines);

    // Create tailer
    return createTextLogTailer(logFile);
  }
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Parse duration string (e.g., "1h", "24h", "1d", "2d") to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like "1h", "24h", "1d"`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  return 0;
}

/**
 * Check if an agent is "interesting" (needs attention)
 */
function isInterestingAgent(agentData: AgentInfo & { live_complete?: boolean; worktree_merged?: boolean }, maxAge: number = 24 * 60 * 60 * 1000): boolean {
  // Active agents are always interesting
  if (['spawned', 'dispatched', 'running'].includes(agentData.status)) return true;

  // Ready to reap (complete but not reaped)
  if (agentData.live_complete && agentData.status === 'dispatched') return true;

  // Failed/blocked/rejected are interesting
  if (['blocked', 'failed', 'rejected'].includes(agentData.status)) return true;

  // Has worktree not yet merged
  if (agentData.worktree && !agentData.worktree_merged) return true;

  // Recently reaped/completed (within maxAge)
  const reapedAt = agentData.reaped_at || agentData.completed_at;
  if (reapedAt) {
    const age = Date.now() - new Date(reapedAt).getTime();
    if (age < maxAge) return true;
  }

  return false;
}

/**
 * Check if agent's worktree branch has been merged to main
 */
function checkWorktreeMerged(agentData: AgentInfo, ops: WorktreeOps): boolean {
  if (!agentData.worktree?.branch) return true; // No worktree = considered merged
  const branch = agentData.worktree.branch;
  // Check if branch exists
  if (!ops.branchExists(branch)) {
    return true; // Branch doesn't exist = already merged/deleted
  }
  // Check if branch is ancestor of HEAD (merged)
  return ops.isAncestor(branch, 'HEAD');
}

export function registerMonitorCommands(agent) {
  // agent:status
  agent.command('status [task-id]')
    .description('Show agent status (all or specific task)')
    .option('--all', 'Show all agents (including old reaped)')
    .option('--active', 'Show only agents with PID (running or dead)')
    .option('--unmerged', 'Show only agents with unmerged worktrees')
    .option('--since <duration>', 'Show agents from last duration (e.g., 1h, 24h, 2d)')
    .option('--git', 'Include git worktree details (branch, ahead/behind, dirty)')
    .option('--json', 'JSON output')
    .action((taskId: string | undefined, options: { all?: boolean; active?: boolean; unmerged?: boolean; since?: string; git?: boolean; json?: boolean }) => {
      const state = loadState();
      const agents: Record<string, AgentInfo> = state.agents || {};
      const agentUtils = new AgentUtils(getAgentsDir());

      if (taskId) {
        taskId = normalizeId(taskId);

        const agentData = agents[taskId];
        if (!agentData) {
          console.error(`No agent found for task: ${taskId}`);
          process.exit(1);
        }

        const completion = agentUtils.checkCompletion(taskId, agentData as AgentCompletionInfo);
        // Status-based completion: reaped/merged/collected means complete
        const statusComplete = ['reaped', 'merged', 'collected'].includes(agentData.status);
        const isComplete = completion.complete || statusComplete;
        const liveStatus = isComplete ? 'complete' : agentData.status;

        // Check if process is actually running (only for active agents)
        const isActive = ['dispatched', 'running', 'spawned'].includes(agentData.status);
        const processInfo = (isActive && agentData.pid) ? getProcessStats(agentData.pid) : { running: false };

        if (options.json) {
          jsonOut({
            task_id: taskId,
            ...agentData,
            live_status: liveStatus,
            ...(isActive && { process_running: processInfo.running }),
            ...completion,
            complete: isComplete
          });
        } else {
          console.log(`Agent: ${taskId}`);
          console.log(`  Status: ${agentData.status}${isComplete ? ' (complete)' : ''}`);
          // Show PID for active agents
          if (agentData.pid && isActive) {
            const procState = processInfo.running ? 'running' : 'not running';
            console.log(`  PID: ${agentData.pid} (${procState})`);
          }
          console.log(`  Started: ${agentData.spawned_at || agentData.started_at || 'unknown'}`);
          // Show last activity from log file mtime
          if (agentData.log_file && fs.existsSync(agentData.log_file)) {
            const logStat = fs.statSync(agentData.log_file);
            console.log(`  Last activity: ${logStat.mtime.toISOString()}`);
          }
          console.log(`  Mission: ${agentData.mission_file}`);
          console.log(`  Complete: ${isComplete ? 'yes' : 'no'}`);
          if (completion.hasResult) console.log(`  Result: ${path.join(completion.agentDir, 'result.yaml')}`);
          if (completion.hasSentinel) console.log(`  Sentinel: ${path.join(completion.agentDir, 'done')}`);
          if (agentData.completed_at) {
            console.log(`  Collected: ${agentData.completed_at}`);
          }
          // Show git worktree details if --git flag
          if (options.git && agentData.worktree) {
            const projectRoot = findProjectRoot();
            const worktreePath = getWorktreePath(taskId);
            const mainBranch = agentData.worktree.base_branch || 'main';
            const diagnosis = diagnoseWorktreeState(worktreePath, projectRoot, mainBranch);
            console.log(`  Worktree:`);
            console.log(`    Branch: ${diagnosis.details.branch || 'unknown'}`);
            console.log(`    Path: ${worktreePath}`);
            const gitParts = [];
            if (diagnosis.details.ahead > 0) gitParts.push(`↑${diagnosis.details.ahead}`);
            if (diagnosis.details.behind > 0) gitParts.push(`↓${diagnosis.details.behind}`);
            if (!diagnosis.details.clean) gitParts.push('dirty');
            if (gitParts.length > 0) {
              console.log(`    State: ${gitParts.join(' ')}`);
            } else {
              console.log(`    State: clean, up-to-date`);
            }
            // Show last commit date
            if (diagnosis.details.exists && fs.existsSync(worktreePath)) {
              try {
                const lastCommit = execSync('LC_ALL=C git log -1 --format=%cr 2>/dev/null', { cwd: worktreePath, encoding: 'utf-8' }).trim();
                if (lastCommit) {
                  console.log(`    Last commit: ${lastCommit}`);
                }
              } catch { /* ignore */ }
            }
            if (diagnosis.details.conflictFiles?.length > 0) {
              console.log(`    Conflicts: ${diagnosis.details.conflictFiles.join(', ')}`);
            }
          }
        }
        return;
      }

      const projectRoot = findProjectRoot();
      const worktreeOps = new WorktreeOps(projectRoot, getWorktreesDir());

      // Build agent list with live status info
      let agentList = Object.entries(agents).map(([id, data]) => {
        const completion = agentUtils.checkCompletion(id, data as AgentCompletionInfo);
        const worktreeMerged = checkWorktreeMerged(data, worktreeOps);
        return {
          task_id: id,
          ...data,
          live_complete: completion.complete,
          worktree_merged: worktreeMerged
        };
      });

      // Apply filters
      if (options.since) {
        const sinceMs = parseDuration(options.since);
        const cutoff = Date.now() - sinceMs;
        agentList = agentList.filter(a => {
          const startedAt = a.spawned_at || a.started_at;
          return startedAt && new Date(startedAt).getTime() >= cutoff;
        });
      } else if (!options.all) {
        // Default: only show interesting agents
        agentList = agentList.filter(a => isInterestingAgent(a));
      }

      // Filter by active (has PID)
      if (options.active) {
        agentList = agentList.filter(a => a.pid);
      }

      // Filter by unmerged worktrees
      if (options.unmerged) {
        agentList = agentList.filter(a => a.worktree && !a.worktree_merged);
      }

      if (options.json) {
        jsonOut(agentList);
        return;
      }

      if (agentList.length === 0) {
        let hint = '';
        if (options.unmerged) {
          hint = ' (all worktrees merged)';
        } else if (options.active) {
          hint = ' (no agents have PID)';
        } else if (!options.all) {
          hint = ' (use --all to show old agents)';
        }
        console.log(`No agents to show${hint}`);
        return;
      }

      // ANSI colors
      const gray = '\x1b[90m';
      const green = '\x1b[32m';
      const yellow = '\x1b[33m';
      const red = '\x1b[31m';
      const cyan = '\x1b[36m';
      const reset = '\x1b[0m';
      const dim = '\x1b[2m';

      // Add last activity and sort by most recent at bottom
      const agentListWithActivity = agentList.map(a => {
        let lastActivity: Date | null = null;
        if (a.log_file && fs.existsSync(a.log_file)) {
          lastActivity = fs.statSync(a.log_file).mtime;
        } else if (a.spawned_at || a.started_at) {
          lastActivity = new Date(a.spawned_at || a.started_at);
        }
        return { ...a, last_activity: lastActivity };
      });

      // Sort: oldest first, most recent at bottom
      agentListWithActivity.sort((a, b) => {
        const aTime = a.last_activity?.getTime() || 0;
        const bTime = b.last_activity?.getTime() || 0;
        return aTime - bTime;
      });

      const statusIconMap: Record<string, { icon: string; color: string }> = {
        'running': { icon: '●', color: green },
        'spawned': { icon: '◐', color: yellow },
        'dispatched': { icon: '◐', color: yellow },
        'completed': { icon: '✓', color: green },
        'reaped': { icon: '✓', color: green },
        'merged': { icon: '✓✓', color: green },
        'collected': { icon: '✓', color: green },
        'failed': { icon: '✗', color: red },
        'blocked': { icon: '⊘', color: red },
        'rejected': { icon: '✗', color: red },
        'dead': { icon: '✖', color: red }
      };

      let title = options.all ? 'All agents' : (options.since ? `Agents (since ${options.since})` : 'Agents (recent/active)');
      if (options.active) title += ' with PID';
      if (options.unmerged) title += ' unmerged';
      console.log(`${title}:\n`);

      for (let i = 0; i < agentListWithActivity.length; i++) {
        const agentData = agentListWithActivity[i];
        const isLast = i === agentListWithActivity.length - 1;
        const treeChar = isLast ? '└── ' : '├── ';

        // Check if agent is dead (has PID but process not running, and status suggests it should be)
        const isActiveStatus = ['spawned', 'dispatched', 'running'].includes(agentData.status);
        const processInfo = agentData.pid ? getProcessStats(agentData.pid) : { running: false };
        const isDead = isActiveStatus && agentData.pid && !processInfo.running;

        const displayStatus = isDead ? 'dead' : agentData.status;
        const statusInfo = statusIconMap[displayStatus] || { icon: '○', color: gray };

        // Build line
        let line = `${gray}${treeChar}${reset}`;
        line += `${statusInfo.color}${statusInfo.icon}${reset} `;
        line += `${agentData.task_id}`;
        line += `  ${isDead ? red : dim}${displayStatus}${reset}`;

        // Ready to reap indicator
        if (agentData.live_complete && agentData.status === 'dispatched') {
          line += `  ${green}[ready to reap]${reset}`;
        }

        // Worktree not merged
        if (agentData.worktree && !agentData.worktree_merged) {
          line += `  ${yellow}[unmerged]${reset}`;
        }

        // PID for active agents (show even if dead)
        if (agentData.pid && isActiveStatus) {
          const pidColor = processInfo.running ? green : red;
          const pidStatus = processInfo.running ? 'running' : 'stopped';
          line += `  ${dim}PID:${reset}${pidColor}${agentData.pid} (${pidStatus})${reset}`;
        }

        // Last activity
        if (agentData.last_activity) {
          const ago = formatDuration(Date.now() - agentData.last_activity.getTime());
          line += `  ${dim}(${ago} ago)${reset}`;
        }

        console.log(line);
      }
    });

  // agent:list
  agent.command('list')
    .description('List all agents with status and details')
    .option('--active', 'Only show active agents (spawned/dispatched/running)')
    .option('--json', 'JSON output')
    .action((options: { active?: boolean; json?: boolean }) => {
      const state = loadState();
      const agents = state.agents || {};
      const agentUtils = new AgentUtils(getAgentsDir());

      let agentList = Object.entries(agents).map(([id, info]) => {
        const agentData = info;
        const completion = agentUtils.checkCompletion(id, agentData as AgentCompletionInfo);
        const liveComplete = completion.complete;

        return {
          task_id: id,
          status: agentData.status,
          live_complete: liveComplete,
          started_at: agentData.spawned_at,
          pid: agentData.pid,
          worktree: agentData.worktree?.path,
          branch: agentData.worktree?.branch,
          log_file: agentData.log_file
        };
      });

      if (options.active) {
        agentList = agentList.filter(a =>
          ['spawned', 'dispatched', 'running'].includes(a.status)
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

      console.log('TASK    STATUS      STARTED     WORKTREE');
      console.log('─'.repeat(60));

      for (const agentData of agentList) {
        const status = agentData.status.padEnd(11);
        const started = timeAgo(agentData.started_at).padEnd(11);
        const worktree = agentData.worktree || '-';

        let statusIndicator = '';
        if (agentData.live_complete && agentData.status === 'dispatched') {
          statusIndicator = ' ✓';
        } else if (agentData.pid) {
          statusIndicator = ` (PID ${agentData.pid})`;
        }

        console.log(`${agentData.task_id}    ${status} ${started} ${worktree}${statusIndicator}`);
      }
    });

  // agent:wait - Reattach to running agent (tail + heartbeat + auto-reap)
  agent.command('wait <task-id>')
    .description('Reattach to running agent (tail log, heartbeat, auto-reap)')
    .option('--timeout <seconds>', 'Timeout in seconds (default: 3600)', parseInt, 3600)
    .option('--no-log', 'Do not tail the log file')
    .option('--no-heartbeat', 'Do not show periodic heartbeat')
    .option('--heartbeat <seconds>', 'Heartbeat interval (default: 30)', parseInt, 30)
    .option('-n, --lines <n>', 'Number of recent lines to show (default: 20)', parseInt)
    .option('-e, --events', 'Use jsonlog instead of raw text log')
    .option('--raw', 'With --events: output raw JSON lines (no summarizing)')
    .option('--json', 'JSON output for wait result')
    .action(async (taskId: string, options: {
      timeout: number;
      log?: boolean;
      heartbeat?: number | boolean;
      reap?: boolean;
      lines?: number;
      events?: boolean;
      raw?: boolean;
      json?: boolean;
    }) => {
      taskId = normalizeId(taskId);

      const state = loadState();
      const agentInfo = state.agents?.[taskId];
      const projectRoot = findProjectRoot();
      const agentUtils = new AgentUtils(getAgentsDir());

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(1);
      }

      const initialCompletion = agentUtils.checkCompletion(taskId, agentInfo as AgentCompletionInfo);
      if (initialCompletion.complete) {
        if (options.json) {
          jsonOut({ task_id: taskId, status: 'already_complete' });
        } else {
          console.log(`${taskId} already completed`);
          if (options.reap !== false) {
            console.log(`\nReaping ${taskId}...`);
            const reapResult = await getAgentLifecycle(taskId).reap();
            if (reapResult.success) {
              console.log(`✓ Task ${taskId} → ${reapResult.taskStatus}`);
            } else if (reapResult.escalate) {
              console.error(`Reap failed: ${reapResult.escalate.reason}`);
            }
          }
        }
        return;
      }

      const startTime = Date.now();
      const timeoutMs = options.timeout * 1000;
      const heartbeatSec = typeof options.heartbeat === 'number' ? options.heartbeat : 30;
      const heartbeatInterval = heartbeatSec * 1000;
      const shouldHeartbeat = options.heartbeat !== false;
      const shouldLog = options.log !== false;
      let lastHeartbeat = startTime;

      const pid = agentInfo.pid;
      const logFile = agentInfo.log_file;
      const agentDir = agentUtils.getAgentDir(taskId);

      const rawJsonMode = options.events && options.raw;
      if (!rawJsonMode) {
        const logMode = options.events ? 'jsonlog' : 'log';
        console.log(`Attaching to ${taskId}${pid ? ` (PID ${pid})` : ''} [${logMode}]`);
        console.log('─'.repeat(60));
      }

      let logTailer: LogTailerResult | null = null;

      if (shouldLog && logFile) {
        logTailer = setupAgentLogTail(taskId, agentDir, logFile, {
          events: options.events,
          raw: options.raw,
          lines: options.lines
        });
      }

      const emitHeartbeat = () => {
        const elapsed = Date.now() - startTime;
        const stats = pid ? getProcessStats(pid) : { running: false };
        const memInfo = stats.mem ? ` (mem: ${stats.mem})` : '';
        const statusText = stats.running ? 'running' : 'stopped';
        console.log(`\n[${formatDuration(elapsed)}] pong — ${taskId} ${statusText}${memInfo}`);
        lastHeartbeat = Date.now();
      };

      const sighupHandler = () => emitHeartbeat();
      process.on('SIGHUP', sighupHandler);

      const sigintHandler = () => {
        if (!options.json) {
          console.log(`\n\nDetaching from ${taskId}`);
          console.log(`Reattach: bin/rudder agent:wait ${taskId}`);
        }
        cleanup();
        process.exit(0);
      };
      process.on('SIGINT', sigintHandler);

      let heartbeatTimer = null;
      let pollTimer = null;

      const cleanup = () => {
        process.off('SIGHUP', sighupHandler);
        process.off('SIGINT', sigintHandler);
        if (logTailer) logTailer.cleanup();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (pollTimer) clearInterval(pollTimer);
      };

      if (shouldHeartbeat && !options.json) {
        heartbeatTimer = setInterval(() => {
          emitHeartbeat();
        }, heartbeatInterval);
      }

      let completed = false;
      let exitCode = null;

      await new Promise<void>((resolve) => {
        pollTimer = setInterval(() => {
          if (Date.now() - startTime > timeoutMs) {
            cleanup();
            if (options.json) {
              jsonOut({ task_id: taskId, status: 'timeout', elapsed_ms: Date.now() - startTime });
            } else {
              console.error(`\n✗ Timeout waiting for ${taskId}`);
            }
            process.exit(2);
          }

          const currentState = loadState();
          const currentAgentInfo = currentState.agents?.[taskId];
          const completion = agentUtils.checkCompletion(taskId, currentAgentInfo as AgentCompletionInfo);
          if (completion.complete) {
            completed = true;
            exitCode = currentAgentInfo?.exit_code ?? 0;
            resolve();
          }
        }, 1000);
      });

      cleanup();

      const elapsed = Date.now() - startTime;

      if (options.json) {
        jsonOut({
          task_id: taskId,
          status: exitCode === 0 ? 'completed' : 'error',
          exit_code: exitCode,
          elapsed_ms: elapsed
        });
        return;
      }

      console.log('\n' + '─'.repeat(60));
      if (exitCode === 0) {
        console.log(`✓ ${taskId} completed (${formatDuration(elapsed)})`);
      } else {
        console.log(`✗ ${taskId} failed (exit: ${exitCode}, ${formatDuration(elapsed)})`);
      }

      if (exitCode === 0 && options.reap !== false) {
        console.log(`\nAuto-reaping ${taskId}...`);
        const reapResult = await getAgentLifecycle(taskId).reap();
        if (reapResult.success) {
          console.log(`✓ Task ${taskId} → ${reapResult.taskStatus}`);
        } else if (reapResult.escalate) {
          console.error(`Reap failed: ${reapResult.escalate.reason}`);
          console.error(`Manual: bin/rudder agent:reap ${taskId}`);
        }
      } else if (exitCode !== 0) {
        console.log(`\nNext steps:`);
        console.log(`  bin/rudder agent:log ${taskId}     # Check full log`);
        console.log(`  bin/rudder agent:reject ${taskId}  # Discard work`);
      }
    });

  // agent:wait-all - Efficient wait for multiple agents using fs.watch
  agent.command('wait-all [task-ids...]')
    .description('Wait for agents to complete (all active if no IDs specified)')
    .option('--any', 'Return when first agent completes (default: wait for all)')
    .option('--timeout <seconds>', 'Timeout in seconds (default: 3600)', parseInt, 3600)
    .option('--heartbeat <seconds>', 'Heartbeat interval in seconds (default: 30)', parseInt, 30)
    .option('--json', 'JSON output')
    .action(async (taskIds: string[], options: {
      any?: boolean;
      timeout: number;
      heartbeat: number;
      json?: boolean;
    }) => {
      const state = loadState();
      const agents = state.agents || {};

      const waitFor = taskIds.length > 0
        ? taskIds.map(id => normalizeId(id))
        : Object.entries(agents)
            .filter(([_, info]) => ['spawned', 'dispatched', 'running'].includes((info).status))
            .map(([id]) => id);

      if (waitFor.length === 0) {
        if (options.json) {
          jsonOut({ status: 'no_agents', completed: [] });
        } else {
          console.log('No active agents to wait for');
        }
        return;
      }

      if (!options.json) {
        const mode = options.any ? 'any' : 'all';
        console.log(`Waiting for ${mode} of ${waitFor.length} agent(s): ${waitFor.join(', ')}`);
      }

      const agentUtils = new AgentUtils(getAgentsDir());
      const startTime = Date.now();
      const timeoutMs = options.timeout * 1000;
      const completed = [];
      const agentsDir = getAgentsDir();
      const stateFile = path.join(agentsDir, '..', 'state.json');

      const checkAllCompletion = () => {
        const currentState = loadState();
        for (const taskId of waitFor) {
          if (completed.includes(taskId)) continue;
          const agentInfo = currentState.agents?.[taskId];
          const completion = agentUtils.checkCompletion(taskId, agentInfo as AgentCompletionInfo);
          if (completion.complete) {
            completed.push(taskId);
            if (!options.json) {
              console.log(`  ✓ ${taskId} completed`);
            }
            if (options.any) return true;
          }
        }
        return completed.length >= waitFor.length;
      };

      if (checkAllCompletion()) {
        if (options.json) {
          jsonOut({ status: 'complete', completed, elapsed_ms: Date.now() - startTime });
        } else if (!options.any) {
          console.log(`✓ All ${waitFor.length} agent(s) completed`);
        }
        return;
      }

      return new Promise<void>((resolve) => {
        let watcher;
        let pollInterval;

        const cleanup = () => {
          if (watcher) watcher.close();
          if (pollInterval) clearInterval(pollInterval);
        };

        const onComplete = () => {
          cleanup();
          if (options.json) {
            jsonOut({ status: 'complete', completed, elapsed_ms: Date.now() - startTime });
          } else if (!options.any) {
            console.log(`✓ All ${waitFor.length} agent(s) completed`);
          }
          resolve();
        };

        const onTimeout = () => {
          cleanup();
          if (options.json) {
            jsonOut({
              status: 'timeout',
              completed,
              pending: waitFor.filter(id => !completed.includes(id)),
              elapsed_ms: Date.now() - startTime
            });
          } else {
            console.error(`\n✗ Timeout after ${options.timeout}s`);
            console.error(`  Completed: ${completed.length}/${waitFor.length}`);
          }
          process.exit(2);
        };

        try {
          watcher = fs.watch(stateFile, { persistent: true }, (eventType) => {
            if (eventType === 'change' && checkAllCompletion()) {
              onComplete();
            }
          });
        } catch (e) {
          // fs.watch not available, use polling
        }

        const heartbeatIntervalMs = (typeof options.heartbeat === 'number' ? options.heartbeat : 30) * 1000;
        let lastHeartbeat = startTime;

        pollInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;

          if (elapsed > timeoutMs) {
            onTimeout();
            return;
          }

          if (checkAllCompletion()) {
            onComplete();
            return;
          }

          if (!options.json && (Date.now() - lastHeartbeat >= heartbeatIntervalMs)) {
            const elapsedSec = Math.floor(elapsed / 1000);
            const pending = waitFor.filter(id => !completed.includes(id));
            console.log(`[${elapsedSec}s] pong — waiting for ${pending.length} agent(s): ${pending.join(', ')}`);
            lastHeartbeat = Date.now();
          }
        }, 2000);

        setTimeout(onTimeout, timeoutMs);
      });
    });

  // agent:log - Show agent log (with optional tail/events mode)
  agent.command('log <task-id>')
    .description('Show agent log (--tail to follow, --events for JSON events, combine both to tail jsonlog)')
    .option('-n, --lines <n>', 'Last N lines (default: all, or 20 with --tail, or 50 with --events)', parseInt)
    .option('-t, --tail', 'Follow log in real-time (Ctrl+C to stop)')
    .option('-e, --events', 'Show filtered JSON events from run.jsonlog')
    .option('--raw', 'With --events: output raw JSON lines (no summarizing)')
    .option('--json', 'JSON output')
    .action((taskId: string, options: { lines?: number; tail?: boolean; events?: boolean; raw?: boolean; json?: boolean }) => {
      const normalizedId = normalizeId(taskId);
      const agentUtils = new AgentUtils(getAgentsDir());

      // Events mode: show filtered JSON events from run.jsonlog
      if (options.events) {
        const agentDir = agentUtils.getAgentDir(normalizedId);
        const jsonLogFile = path.join(agentDir, 'run.jsonlog');

        if (!fs.existsSync(jsonLogFile)) {
          console.error(`JSON log file not found: ${jsonLogFile}`);
          process.exit(1);
        }

        const taskEpic = getTaskEpic(normalizedId);
        const epicId = taskEpic?.epicId || null;
        const noiseFilters = options.raw ? [] : getDiagnoseOps().loadNoiseFilters(epicId);

        // Tail mode for events: follow jsonlog in real-time
        if (options.tail) {
          // Show recent lines/events
          showRecentJsonLog(jsonLogFile, options.lines ?? 20, noiseFilters, options.raw);

          // Start tailing (raw mode = output lines as-is)
          const tailer = createJsonLogTailer(jsonLogFile, noiseFilters, options.raw);

          process.on('SIGINT', () => {
            tailer.cleanup();
            console.log('\n\nStopped.');
            process.exit(0);
          });
          return;
        }

        // Raw JSON mode (static): output raw jsonlog lines
        if (options.raw) {
          const content = fs.readFileSync(jsonLogFile, 'utf8');
          const allLines = content.split('\n').filter(l => l.trim());
          const limit = options.lines ?? allLines.length;
          for (const line of allLines.slice(0, limit)) {
            console.log(line);
          }
          return;
        }

        // Static events display
        const { events, lines } = parseJsonLog(jsonLogFile);
        const limit = options.lines ?? 50;
        const output: any[] = [];
        let filtered = 0;

        for (let i = 0; i < events.length; i++) {
          const event = events[i];
          const line = lines[i];

          let isNoise = false;
          for (const filter of noiseFilters) {
            if (matchesNoiseFilter(line, event, filter)) {
              isNoise = true;
              filtered++;
              break;
            }
          }

          if (isNoise) continue;

          if (output.length < limit) {
            if (options.json) {
              output.push({ line: i + 1, type: event.type, event });
            } else {
              output.push({ line: i + 1, summary: summarizeEvent(event, line) });
            }
          }
        }

        if (options.json) {
          jsonOut({
            task_id: normalizedId,
            epic_id: epicId,
            total: events.length,
            filtered,
            shown: output.length,
            events: output
          });
        } else {
          console.log(`Task: ${normalizedId} | Epic: ${epicId || 'unknown'}`);
          console.log(`Events: ${events.length} total, ${filtered} filtered, showing ${output.length}`);
          console.log('---');
          for (const o of output) {
            console.log(`${o.line}: ${o.summary}`);
          }
        }
        return;
      }

      // Raw text log file
      const logFile = agentUtils.getLogFilePath(normalizedId);

      if (!fs.existsSync(logFile)) {
        console.error(`No log file for ${taskId}`);
        process.exit(1);
      }

      const content = fs.readFileSync(logFile, 'utf8');
      const allLines = content.split('\n');

      // Tail mode: follow in real-time
      if (options.tail) {
        console.log(`Following ${normalizedId} log... (Ctrl+C to stop)\n`);
        console.log('─'.repeat(60) + '\n');

        // Show recent lines and start tailing
        showRecentTextLog(logFile, options.lines ?? 20);
        const tailer = createTextLogTailer(logFile);

        process.on('SIGINT', () => {
          tailer.cleanup();
          console.log('\n\nStopped.');
          process.exit(0);
        });
        return;
      }

      // Normal mode: show log content
      if (options.json) {
        jsonOut({
          task_id: normalizedId,
          log_file: logFile,
          lines: options.lines ? allLines.slice(-options.lines) : allLines
        });
      } else {
        if (options.lines) {
          console.log(allLines.slice(-options.lines).join('\n'));
        } else {
          console.log(content);
        }
      }
    });
}
