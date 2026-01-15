/**
 * Agent manage commands: sync, clear, kill, conflicts
 */
import fs from 'fs';
import path from 'path';
import { jsonOut, resolvePlaceholders, getAgentConfig } from '../../managers/core-manager.js';
import { getGit } from '../../lib/git.js';
import { loadState, saveState } from '../../managers/state-manager.js';
import { withModifies } from '../../lib/help.js';
import { buildConflictMatrix, suggestMergeOrder } from '../../managers/conflict-manager.js';
import { normalizeId } from '../../lib/normalize.js';

export function registerManageCommands(agent) {
  // agent:sync
  withModifies(agent.command('sync'), ['state'])
    .description('Sync state.json with actual worktrees/agents (recover from ghosts)')
    .action(async (options: { dryRun?: boolean; json?: boolean }) => {
      const config = getAgentConfig();
      const havenPath = resolvePlaceholders('${haven}');
      const worktreesDir = path.join(havenPath, 'worktrees');
      const agentsDir = path.join(havenPath, 'agents');

      const state = loadState();
      if (!state.agents) state.agents = {};

      const changes = { added: [], updated: [], orphaned: [] };

      if (fs.existsSync(worktreesDir)) {
        const worktrees = fs.readdirSync(worktreesDir).filter(d =>
          d.startsWith('T') && fs.statSync(path.join(worktreesDir, d)).isDirectory()
        );

        for (const taskId of worktrees) {
          const worktreePath = path.join(worktreesDir, taskId);
          const agentDir = path.join(agentsDir, taskId);
          const missionFile = path.join(agentDir, 'mission.yaml');
          const logFile = path.join(agentDir, 'run.log');

          if (!state.agents[taskId]) {
            const entry: any = {
              status: 'orphaned',
              recovered_at: new Date().toISOString(),
              worktree: {
                path: worktreePath,
                branch: `task/${taskId}`
              }
            };

            if (fs.existsSync(missionFile)) {
              entry.mission_file = missionFile;
            }
            if (fs.existsSync(logFile)) {
              entry.log_file = logFile;
              try {
                const logContent = fs.readFileSync(logFile, 'utf8');
                if (logContent.includes('exit code: 0') || logContent.includes('Exit code: 0')) {
                  entry.status = 'completed';
                }
              } catch { /* ignore */ }
            }

            const syncGit = getGit(worktreePath);
            const syncStatus = await syncGit.status();
            if (!syncStatus.isClean()) {
              entry.dirty_worktree = true;
              const syncAllFiles = [...syncStatus.modified, ...syncStatus.created, ...syncStatus.deleted, ...syncStatus.not_added];
              entry.uncommitted_files = syncAllFiles.length;
            }

            if (!options.dryRun) {
              state.agents[taskId] = entry;
            }
            changes.added.push({ taskId, status: entry.status });
          } else if (state.agents[taskId].status === 'spawned') {
            const pid = state.agents[taskId].pid;
            let isRunning = false;
            if (pid) {
              try {
                process.kill(pid, 0);
                isRunning = true;
              } catch { /* not running */ }
            }

            if (!isRunning) {
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
  withModifies(agent.command('clear [task-id]'), ['state'])
    .description('Clear agent tracking (all or specific task)')
    .option('--force', 'Clear without confirmation')
    .action((taskId: string | undefined, options: { force?: boolean }) => {
      const state = loadState();

      if (!state.agents) {
        console.log('No agents to clear');
        return;
      }

      if (taskId) {
        taskId = normalizeId(taskId);

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

  // agent:kill
  withModifies(agent.command('kill <task-id>'), ['state'])
    .action((taskId: string, options: { json?: boolean }) => {
      taskId = normalizeId(taskId);

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
        process.kill(pid, 'SIGTERM');
        console.log(`Sent SIGTERM to PID ${pid}`);

        setTimeout(() => {
          try {
            process.kill(pid, 0);
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
    .action(async (options: { json?: boolean }) => {
      const conflictData = await buildConflictMatrix();

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

      console.log('Modified files by agent:');
      for (const [taskId, files] of Object.entries(conflictData.filesByAgent)) {
        const fileList = files as string[];
        console.log(`\n  ${taskId}:`);
        if (fileList.length === 0) {
          console.log('    (no changes)');
        } else {
          fileList.slice(0, 5).forEach(f => console.log(`    ${f}`));
          if (fileList.length > 5) {
            console.log(`    ... and ${fileList.length - 5} more`);
          }
        }
      }

      console.log();

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

        const order = suggestMergeOrder(conflictData);
        console.log('\nSuggested merge order (merge one at a time):');
        order.forEach((id, i) => console.log(`  ${i + 1}. rudder agent:merge ${id}`));
      }
    });
}
