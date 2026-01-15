/**
 * Agent monitor commands: status, list, wait, wait-all, log
 */
import fs from 'fs';
import path from 'path';
import { findProjectRoot, jsonOut } from '../../lib/core.js';
import { execRudderSafe } from '../../lib/invoke.js';
import { loadState } from '../../lib/state.js';
import { normalizeId } from '../../lib/normalize.js';
import {
  getAgentsBaseDir, getAgentDir, getProcessStats, formatDuration,
  checkAgentCompletion, getLogFilePath
} from '../../lib/agent-utils.js';
import { AgentInfo } from '../../lib/types/agent.js';
import { getTaskEpic } from '../../lib/index.js';
import {
  loadNoiseFilters, matchesNoiseFilter, parseJsonLog
} from '../../lib/diagnose.js';
import { summarizeEvent } from './diagnose.js';

export function registerMonitorCommands(agent) {
  // agent:status
  agent.command('status [task-id]')
    .description('Show agent status (all or specific task)')
    .option('--json', 'JSON output')
    .action((taskId: string | undefined, options: { json?: boolean }) => {
      const state = loadState();
      const agents: Record<string, AgentInfo> = state.agents || {};

      if (taskId) {
        taskId = normalizeId(taskId);

        const agentData = agents[taskId];
        if (!agentData) {
          console.error(`No agent found for task: ${taskId}`);
          process.exit(1);
        }

        const completion = checkAgentCompletion(taskId);
        const liveStatus = completion.complete ? 'complete' : agentData.status;

        if (options.json) {
          jsonOut({
            task_id: taskId,
            ...agentData,
            live_status: liveStatus,
            ...completion
          });
        } else {
          console.log(`Agent: ${taskId}`);
          console.log(`  Status: ${agentData.status}${completion.complete ? ' (complete)' : ''}`);
          console.log(`  Started: ${agentData.started_at}`);
          console.log(`  Mission: ${agentData.mission_file}`);
          console.log(`  Complete: ${completion.complete ? 'yes' : 'no'}`);
          if (completion.hasResult) console.log(`  Result: ${path.join(completion.agentDir, 'result.yaml')}`);
          if (completion.hasSentinel) console.log(`  Sentinel: ${path.join(completion.agentDir, 'done')}`);
          if (agentData.completed_at) {
            console.log(`  Collected: ${agentData.completed_at}`);
          }
        }
        return;
      }

      // Show all agents with live completion status
      const agentList: (AgentInfo & { task_id: string; live_complete: boolean })[] = Object.entries(agents).map(([id, data]) => {
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
      for (const agentData of agentList) {
        let status;
        if (agentData.live_complete) {
          status = '✓';
        } else if (agentData.status === 'dispatched') {
          status = '●';
        } else if (agentData.status === 'collected') {
          status = '✓';
        } else {
          status = '✗';
        }
        const completeNote = agentData.live_complete && agentData.status === 'dispatched' ? ' [ready to collect]' : '';
        console.log(`  ${status} ${agentData.task_id}: ${agentData.status}${completeNote}`);
      }
    });

  // agent:list
  agent.command('list')
    .description('List all agents with status and details')
    .option('--active', 'Only show active agents (dispatched/running)')
    .option('--json', 'JSON output')
    .action((options: { active?: boolean; json?: boolean }) => {
      const state = loadState();
      const agents = state.agents || {};

      let agentList = Object.entries(agents).map(([id, info]) => {
        const agentData = info as AgentInfo;
        const completion = checkAgentCompletion(id);
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
    .action(async (taskId: string, options: {
      timeout: number;
      log?: boolean;
      heartbeat?: number | boolean;
      reap?: boolean;
      json?: boolean;
    }) => {
      taskId = normalizeId(taskId);

      const state = loadState();
      const agentInfo = state.agents?.[taskId];
      const projectRoot = findProjectRoot();

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(1);
      }

      const initialCompletion = checkAgentCompletion(taskId);
      if (initialCompletion.complete) {
        if (options.json) {
          jsonOut({ task_id: taskId, status: 'already_complete' });
        } else {
          console.log(`${taskId} already completed`);
          if (options.reap !== false) {
            console.log(`\nReaping ${taskId}...`);
            const { stdout, stderr, exitCode } = execRudderSafe(`agent:reap ${taskId}`, { cwd: projectRoot });
            if (exitCode === 0) {
              if (stdout) console.log(stdout);
            } else {
              console.error(`Reap failed: ${stderr}`);
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

      if (!options.json) {
        console.log(`Attaching to ${taskId}${pid ? ` (PID ${pid})` : ''}`);
        console.log('─'.repeat(60));
      }

      let logWatcher = null;
      let lastLogSize = 0;

      if (shouldLog && logFile && fs.existsSync(logFile)) {
        lastLogSize = fs.statSync(logFile).size;

        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.split('\n');
        const recentLines = lines.slice(-20).join('\n');
        if (recentLines.trim()) {
          console.log('[...recent output...]\n');
          console.log(recentLines);
        }

        logWatcher = fs.watch(logFile, (eventType) => {
          if (eventType === 'change') {
            try {
              const newSize = fs.statSync(logFile).size;
              if (newSize > lastLogSize) {
                const fd = fs.openSync(logFile, 'r');
                const buffer = Buffer.alloc(newSize - lastLogSize);
                fs.readSync(fd, buffer, 0, buffer.length, lastLogSize);
                fs.closeSync(fd);
                process.stdout.write(buffer.toString());
                lastLogSize = newSize;
              }
            } catch { /* ignore */ }
          }
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
        if (logWatcher) logWatcher.close();
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

          const completion = checkAgentCompletion(taskId);
          if (completion.complete) {
            completed = true;
            const currentState = loadState();
            exitCode = currentState.agents?.[taskId]?.exit_code ?? 0;
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
        const { stdout, stderr, exitCode: reapCode } = execRudderSafe(`agent:reap ${taskId}`, { cwd: projectRoot });
        if (reapCode === 0) {
          if (stdout) console.log(stdout);
        } else {
          console.error(`Reap failed: ${stderr}`);
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

      let waitFor = taskIds.length > 0
        ? taskIds.map(id => normalizeId(id))
        : Object.entries(agents)
            .filter(([_, info]) => ['spawned', 'dispatched', 'running'].includes((info as AgentInfo).status))
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

      const startTime = Date.now();
      const timeoutMs = options.timeout * 1000;
      const completed = [];
      const stateFile = path.join(getAgentsBaseDir(), '..', 'state.json');

      const checkCompletion = () => {
        for (const taskId of waitFor) {
          if (completed.includes(taskId)) continue;
          const completion = checkAgentCompletion(taskId);
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

      if (checkCompletion()) {
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
            if (eventType === 'change' && checkCompletion()) {
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

          if (checkCompletion()) {
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
    .description('Show agent log (--tail to follow, --events for JSON events)')
    .option('-n, --lines <n>', 'Last N lines (default: all, or 20 with --tail, or 50 with --events)', parseInt)
    .option('-t, --tail', 'Follow log in real-time (Ctrl+C to stop)')
    .option('-e, --events', 'Show filtered JSON events from run.jsonlog')
    .option('--raw', 'With --events: show raw events (no noise filtering)')
    .option('--json', 'JSON output')
    .action((taskId: string, options: { lines?: number; tail?: boolean; events?: boolean; raw?: boolean; json?: boolean }) => {
      const normalizedId = normalizeId(taskId);

      // Events mode: show filtered JSON events from run.jsonlog
      if (options.events) {
        const agentDir = getAgentDir(normalizedId);
        const jsonLogFile = path.join(agentDir, 'run.jsonlog');

        if (!fs.existsSync(jsonLogFile)) {
          console.error(`JSON log file not found: ${jsonLogFile}`);
          process.exit(1);
        }

        const taskEpic = getTaskEpic(normalizedId);
        const epicId = taskEpic?.epicId || null;
        const noiseFilters = options.raw ? [] : loadNoiseFilters(epicId);
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
      const logFile = getLogFilePath(normalizedId);

      if (!fs.existsSync(logFile)) {
        console.error(`No log file for ${taskId}`);
        process.exit(1);
      }

      const content = fs.readFileSync(logFile, 'utf8');
      const allLines = content.split('\n');

      // Tail mode: follow in real-time
      if (options.tail) {
        const tailLines = options.lines ?? 20;
        console.log(`Following ${normalizedId} log... (Ctrl+C to stop)\n`);
        console.log('─'.repeat(60) + '\n');
        console.log(allLines.slice(-tailLines).join('\n'));

        let lastSize = fs.statSync(logFile).size;

        const watcher = fs.watch(logFile, (eventType) => {
          if (eventType === 'change') {
            const newSize = fs.statSync(logFile).size;
            if (newSize > lastSize) {
              const fd = fs.openSync(logFile, 'r');
              const buffer = Buffer.alloc(newSize - lastSize);
              fs.readSync(fd, buffer, 0, buffer.length, lastSize);
              fs.closeSync(fd);
              process.stdout.write(buffer.toString());
              lastSize = newSize;
            }
          }
        });

        process.on('SIGINT', () => {
          watcher.close();
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
