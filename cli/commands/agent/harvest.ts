/**
 * Agent harvest commands: reap, reject, collect, merge, reap-all
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { execSync } from 'child_process';
import { findProjectRoot, jsonOut, loadFile, saveFile, getAgentsDir } from '../../managers/core-manager.js';
import { parseUpdateOptions } from '../../lib/update.js';
import { getAgentLifecycle } from '../../managers/agent-manager.js';
import { getGit } from '../../lib/git.js';
import { validateResult } from '../../lib/agent-schema.js';
import { getAgentFromDb, saveAgentToDb, getAllAgentsFromDb } from '../../managers/db-manager.js';
import { withModifies } from '../../lib/help.js';
import { getAgentConfig } from '../../managers/core-manager.js';
import { removeWorktree } from '../../managers/worktree-manager.js';
import { getTask, getTaskEpic } from '../../managers/artefacts-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { AgentUtils, type AgentCompletionInfo } from '../../lib/agent-utils.js';
import { getDiagnoseOps, printDiagnoseResult } from '../../managers/diagnose-manager.js';

export function registerHarvestCommands(agent) {
  // agent:reap
  withModifies(agent.command('reap <task-id>'), ['task', 'git', 'db'])
    .description('Harvest agent work: wait, merge, cleanup, update status (or escalate)')
    .option('--role <role>', 'Role context (skill, coordinator) - agent role blocked')
    .option('--no-wait', 'Skip waiting if agent not complete')
    .option('--timeout <seconds>', 'Wait timeout (default: 300)', parseInt, 300)
    .option('-v, --verbose', 'Detailed output')
    .option('--cleanup-worktree-after', 'Remove worktree after merge (default: keep for debug)')
    .option('--json', 'JSON output')
    .action(async (taskId: string, options: {
      role?: string;
      wait?: boolean;
      timeout: number;
      verbose?: boolean;
      cleanupWorktreeAfter?: boolean;
      json?: boolean;
    }) => {
      if (options.role === 'agent') {
        console.error('ERROR: agent:reap cannot be called with --role agent');
        console.error('Agents cannot harvest. Only skill or coordinator can reap.');
        process.exit(1);
      }

      taskId = normalizeId(taskId);

      const agentInfo = getAgentFromDb(taskId);
      const projectRoot = findProjectRoot();
      const config = getAgentConfig();
      const agentsDir = getAgentsDir();
      const agentUtils = new AgentUtils(agentsDir);

      const escalate = (reason, nextSteps) => {
        if (options.json) {
          jsonOut({ task_id: taskId, status: 'blocked', reason, next_steps: nextSteps });
        } else {
          console.error(`\nBLOCKED: ${reason}\n`);
          console.error('Next steps:');
          nextSteps.forEach(step => console.error(`  ${step}`));
        }
        process.exit(1);
      };

      if (!agentInfo) {
        escalate(`No agent found for task ${taskId}`, [`agent:spawn ${taskId}    # Start agent first`]);
      }

      if (agentInfo.pid) {
        try {
          process.kill(agentInfo.pid, 0);
          if (options.wait === false) {
            escalate(`Agent ${taskId} is still running (PID ${agentInfo.pid})`, [
              `agent:wait ${taskId}     # Wait for completion`,
              `agent:kill ${taskId}     # Force terminate`
            ]);
          }
          if (!options.json) console.log(`Waiting for ${taskId} (timeout: ${options.timeout}s)...`);
          const startTime = Date.now();
          const timeoutMs = options.timeout * 1000;
          while (true) {
            const completion = agentUtils.checkCompletion(taskId, agentInfo as AgentCompletionInfo);
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
        } catch { /* not running */ }
      }

      const completion = agentUtils.checkCompletion(taskId, agentInfo as AgentCompletionInfo);
      if (!completion.complete) {
        escalate(`Agent ${taskId} did not complete`, [
          `agent:status ${taskId}    # Check status`,
          `agent:reject ${taskId}    # Discard incomplete work`
        ]);
      }

      let resultStatus = 'completed';
      const agentDir = agentUtils.getAgentDir(taskId);
      const resultFile = path.join(agentDir, 'result.yaml');
      if (fs.existsSync(resultFile)) {
        try {
          const result = yaml.load(fs.readFileSync(resultFile, 'utf8'));
          resultStatus = result.status || 'completed';
        } catch { /* ignore */ }
      }

      if (agentInfo.worktree) {
        const worktreePath = agentInfo.worktree.path;
        const branch = agentInfo.worktree.branch;

        if (!fs.existsSync(worktreePath)) {
          escalate(`Worktree not found: ${worktreePath}`, [`agent:clear ${taskId}    # Clear stale state`]);
        }

        const reapGit = getGit(worktreePath);
        const reapStatus = await reapGit.status();
        if (!reapStatus.isClean()) {
          try {
            const reapAllFiles = [...reapStatus.modified, ...reapStatus.created, ...reapStatus.deleted, ...reapStatus.not_added];
            if (!options.json) console.log(`⚠️  Auto-committing ${reapAllFiles.length} uncommitted file(s)`);
            await reapGit.add('-A');
            await reapGit.commit(`chore(${taskId}): auto-commit agent changes`);
          } catch { /* ignore */ }
        }

        const mainGit = getGit(projectRoot);
        try {
          const mergeBase = await mainGit.raw(['merge-base', 'HEAD', branch]);
          const mergeTree = await mainGit.raw(['merge-tree', mergeBase.trim(), 'HEAD', branch]);

          if (mergeTree.includes('<<<<<<<') || mergeTree.includes('>>>>>>>')) {
            const conflictFiles = [];
            for (const line of mergeTree.split('\n')) {
              if (line.startsWith('changed in both')) {
                const match = line.match(/changed in both\s+(.+)/);
                if (match) conflictFiles.push(match[1]);
              }
            }
            escalate(`Merge conflicts detected`, [
              `/dev:merge ${taskId}                           # Guided conflict resolution`,
              ``, `Manual resolution:`,
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
          escalate(`Cannot check merge status: ${e.message}`, [`git fetch origin`, `agent:reap ${taskId}    # Retry`]);
        }

        const strategy = config.merge_strategy || 'merge';
        try {
          if (!options.json) console.log(`Merging ${branch} → main (${strategy})...`);
          if (strategy === 'squash') {
            await mainGit.merge([branch, '--squash']);
            await mainGit.commit(`feat(${taskId}): ${agentInfo.worktree.branch}`);
          } else if (strategy === 'rebase') {
            await mainGit.rebase([branch]);
          } else {
            await mainGit.merge([branch, '--no-edit']);
          }
        } catch (e) {
          escalate(`Merge failed: ${e.message}`, [`/dev:merge ${taskId}    # Manual resolution`]);
        }

        if (options.cleanupWorktreeAfter) {
          const removeResult = removeWorktree(taskId, { force: true });
          if (!options.json && !removeResult.success) {
            console.error(`Warning: Failed to cleanup worktree: ${removeResult.error}`);
          }
          if (!options.json) console.log(`✓ Merged and cleaned up ${taskId}`);
        } else {
          if (!options.json) console.log(`✓ Merged ${taskId} (worktree kept for debug)`);
        }
      }

      const taskStatus = resultStatus === 'completed' ? 'Done' : 'Blocked';
      const taskFile = getTask(taskId)?.file;
      if (taskFile) {
        const file = loadFile(taskFile);
        const { updated, data } = parseUpdateOptions({ status: taskStatus }, file.data, 'task');
        if (updated) {
          saveFile(taskFile, data, file.body);
          if (!options.json) console.log(`✓ Task ${taskId} → ${taskStatus}`);
        }
      } else {
        if (!options.json) console.error(`Warning: Could not find task file for ${taskId}`);
      }

      await saveAgentToDb(taskId, {
        ...agentInfo,
        status: 'reaped',
        result_status: resultStatus,
        reaped_at: new Date().toISOString()
      });

      if (options.json) {
        jsonOut({
          task_id: taskId,
          status: 'success',
          result_status: resultStatus,
          task_status: taskStatus,
          merged: !!agentInfo.worktree,
          cleaned_up: !!agentInfo.worktree && !!options.cleanupWorktreeAfter
        });
      } else {
        const logFile = path.join(agentDir, 'run.jsonlog');
        if (fs.existsSync(logFile)) {
          const taskEpic = getTaskEpic(taskId);
          const epicIdForLog = taskEpic?.epicId || null;
          const logResult = getDiagnoseOps().analyzeLog(logFile, epicIdForLog);
          if (logResult.errors.length > 0) {
            console.log('\n--- Agent Run Analysis ---');
            console.log('Review errors below:');
            console.log('  - If critical/unrecoverable → STOP and escalate');
            console.log('  - If fixable → handle the issue');
            console.log(`  - If false positive → rudder agent:log-noise-add-filter <filter-id> ${epicIdForLog || 'global'} --contains "pattern"`);
            console.log('');
            printDiagnoseResult(taskId, logResult);
          }
        }
      }
    });

  // agent:merge (DEPRECATED)
  withModifies(agent.command('merge <task-id>'), ['task', 'git', 'db'])
    .description('[DEPRECATED] Merge agent worktree → use agent:reap instead')
    .option('--strategy <type>', 'Merge strategy: merge|squash|rebase (default from config)')
    .option('--no-cleanup', 'Keep worktree after merge')
    .option('--json', 'JSON output')
    .action(async (taskId: string, options: { strategy?: string; cleanup?: boolean; json?: boolean }) => {
      console.error('⚠️  DEPRECATED: agent:merge is deprecated. Use agent:reap instead.');
      console.error('   agent:reap handles merge, cleanup, and status update.\n');

      taskId = normalizeId(taskId);
      const agentInfo = getAgentFromDb(taskId);
      const agentUtilsMerge = new AgentUtils(getAgentsDir());

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(1);
      }
      if (!agentInfo.worktree) {
        console.error(`Task ${taskId} was not dispatched with worktree mode`);
        process.exit(1);
      }

      const completion = agentUtilsMerge.checkCompletion(taskId, agentInfo as AgentCompletionInfo);
      if (!completion.complete) {
        console.error(`Agent ${taskId} has not completed`);
        process.exit(1);
      }

      const projectRoot = findProjectRoot();
      const worktreePath = agentInfo.worktree.path;
      const branch = agentInfo.worktree.branch;

      if (!fs.existsSync(worktreePath)) {
        console.error(`Worktree not found: ${worktreePath}`);
        process.exit(1);
      }

      const config = getAgentConfig();
      const strategy = options.strategy || config.merge_strategy || 'merge';

      try {
        const mergeBase = execSync(`git merge-base HEAD ${branch}`, { cwd: projectRoot, encoding: 'utf8' }).trim();
        const mergeTree = execSync(`git merge-tree ${mergeBase} HEAD ${branch}`, { cwd: projectRoot, encoding: 'utf8' });
        if (mergeTree.includes('<<<<<<<') || mergeTree.includes('>>>>>>>')) {
          console.error(`Merge conflicts detected. Please resolve manually.`);
          process.exit(1);
        }
      } catch (e) {
        console.error(`Error checking for conflicts: ${e.message}`);
        process.exit(1);
      }

      try {
        if (strategy === 'merge') {
          execSync(`git merge ${branch} --no-edit`, { cwd: projectRoot, stdio: 'inherit' });
        } else if (strategy === 'squash') {
          execSync(`git merge --squash ${branch}`, { cwd: projectRoot, stdio: 'inherit' });
          console.log('\nSquash complete. Changes are staged but not committed.');
        } else if (strategy === 'rebase') {
          execSync(`git rebase ${branch}`, { cwd: projectRoot, stdio: 'inherit' });
        }
      } catch (e) {
        console.error(`Merge failed: ${e.message}`);
        process.exit(1);
      }

      if (options.cleanup !== false) {
        const removeResult = removeWorktree(taskId, { force: true });
        if (!removeResult.success) console.error(`Warning: Failed to remove worktree: ${removeResult.error}`);
      }

      await saveAgentToDb(taskId, { ...agentInfo, status: 'merged', merge_strategy: strategy, merged_at: new Date().toISOString() });

      if (options.json) {
        jsonOut({ task_id: taskId, status: 'merged', strategy, branch, cleanup: options.cleanup !== false });
      } else {
        console.log(`\n✓ Merged: ${taskId}`);
        console.log(`  Strategy: ${strategy}`);
      }
    });

  // agent:reject
  withModifies(agent.command('reject <task-id>'), ['task', 'git', 'db'])
    .description('Reject agent work and cleanup worktree')
    .option('--reason <text>', 'Rejection reason (logged)')
    .option('--status <status>', 'New task status: blocked|not-started (default: blocked)', 'blocked')
    .option('--json', 'JSON output')
    .action(async (taskId: string, options: { reason?: string; status: string; json?: boolean }) => {
      taskId = normalizeId(taskId);
      const agentInfo = getAgentFromDb(taskId);

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(1);
      }

      if (agentInfo.worktree) {
        const removeResult = removeWorktree(taskId, { force: true });
        if (!removeResult.success) console.error(`Warning: Failed to remove worktree: ${removeResult.error}`);
      }

      const statusMap = { 'blocked': 'Blocked', 'not-started': 'Not Started' };
      const taskStatus = statusMap[options.status] || 'Blocked';

      await saveAgentToDb(taskId, { ...agentInfo, status: 'rejected', reject_reason: options.reason, rejected_at: new Date().toISOString() });

      if (options.json) {
        jsonOut({ task_id: taskId, status: 'rejected', task_status: taskStatus, reason: options.reason });
      } else {
        console.log(`✗ Rejected: ${taskId}`);
        if (options.reason) console.log(`  Reason: ${options.reason}`);
        if (agentInfo.worktree) console.log(`  Worktree cleaned up`);
        console.log(`\nTo update task status: rudder task:update ${taskId} --status "${taskStatus}"`);
      }
    });

  // agent:collect (DEPRECATED)
  withModifies(agent.command('collect <task-id>'), ['db'])
    .description('[DEPRECATED] Collect agent result → use agent:reap instead')
    .option('--json', 'JSON output')
    .action(async (taskId: string, options: { json?: boolean }) => {
      console.error('⚠️  DEPRECATED: agent:collect is deprecated. Use agent:reap instead.');
      console.error('   agent:reap collects, merges, cleans up, and updates status.\n');

      taskId = normalizeId(taskId);
      const agentInfo = getAgentFromDb(taskId);
      const agentUtilsCollect = new AgentUtils(getAgentsDir());

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(1);
      }

      const agentDir = agentUtilsCollect.getAgentDir(taskId);
      const resultFile = path.join(agentDir, 'result.yaml');

      if (!fs.existsSync(resultFile)) {
        console.error(`Result file not found: ${resultFile}`);
        process.exit(1);
      }

      let result;
      try {
        result = yaml.load(fs.readFileSync(resultFile, 'utf8'));
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

      const statusMap = { completed: 'Done', failed: 'Blocked', blocked: 'Blocked' };
      const taskStatus = statusMap[result.status] || 'Blocked';

      await saveAgentToDb(taskId, {
        ...agentInfo,
        status: 'collected',
        result_status: result.status,
        completed_at: result.completed_at
      });

      if (options.json) {
        jsonOut({ task_id: taskId, result_status: result.status, task_status: taskStatus });
      } else {
        const statusSymbol = result.status === 'completed' ? '✓' : result.status === 'failed' ? '✗' : '⚠';
        console.log(`${statusSymbol} Collected: ${taskId}`);
        console.log(`  Result: ${result.status} → Task: ${taskStatus}`);
      }
    });

  // agent:reap-all
  withModifies(agent.command('reap-all [task-ids...]'), ['task', 'git', 'db'])
    .description('Reap all completed agents (all if no IDs specified)')
    .option('--json', 'JSON output')
    .action(async (taskIds: string[], options: { json?: boolean }) => {
      const agents = getAllAgentsFromDb();
      const projectRoot = findProjectRoot();
      const agentUtilsReapAll = new AgentUtils(getAgentsDir());

      const toReap = taskIds.length > 0 ? taskIds.map(id => normalizeId(id)) : Object.keys(agents);
      const completed = toReap.filter(taskId => {
        const agentInfo = agents[taskId];
        const completion = agentUtilsReapAll.checkCompletion(taskId, agentInfo as AgentCompletionInfo);
        return completion.complete;
      });

      if (completed.length === 0) {
        if (options.json) {
          jsonOut({ status: 'none', reaped: [] });
        } else {
          console.log('No completed agents to reap');
        }
        return;
      }

      if (!options.json) console.log(`Reaping ${completed.length} agent(s)...`);

      const results = [];
      for (const taskId of completed) {
        const reapResult = await getAgentLifecycle(taskId).reap();
        if (reapResult.success) {
          results.push({ task_id: taskId, status: 'reaped', task_status: reapResult.taskStatus });
          if (!options.json) console.log(`  ✓ ${taskId} reaped → ${reapResult.taskStatus}`);
        } else {
          const errorMsg = reapResult.escalate?.reason || 'unknown error';
          results.push({ task_id: taskId, status: 'failed', error: errorMsg.slice(0, 100) });
          if (!options.json) console.error(`  ✗ ${taskId} failed: ${errorMsg.slice(0, 50)}`);
        }
      }

      if (options.json) {
        jsonOut({ status: 'complete', reaped: results });
      } else {
        const succeeded = results.filter(r => r.status === 'reaped').length;
        console.log(`\n✓ Reaped ${succeeded}/${completed.length} agent(s)`);
      }
    });
}
