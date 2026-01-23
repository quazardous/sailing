/**
 * Worktree management commands (cleanup, sync)
 */
import fs from 'fs';
import { Command } from 'commander';
import { findProjectRoot, jsonOut } from '../../managers/core-manager.js';
import { getAgentFromDb, getAllAgentsFromDb, updateAgentInDb } from '../../managers/db-manager.js';
import { getAgentConfig } from '../../managers/core-manager.js';
import { getWorktreePath, cleanupWorktree } from '../../managers/worktree-manager.js';
import { detectProvider } from '../../managers/pr-manager.js';
import { getPrStatus } from './helpers.js';
import type { AgentRecord } from '../../lib/types/agent.js';
import type { CleanupOptions, SyncOptions, PrStatus } from './helpers.js';

/**
 * Register worktree:cleanup and worktree:sync commands
 */
export function registerManageCommands(worktree: Command): void {
  // worktree:cleanup
  worktree.command('cleanup <task-id>')
    .description('Remove worktree and branch after PR is merged')
    .option('--force', 'Force cleanup even if PR not merged')
    .option('--json', 'JSON output')
    .action(async (taskIdParam: string, options: CleanupOptions) => {
      let taskId: string = taskIdParam.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const projectRoot = findProjectRoot();
      const agentInfo = getAgentFromDb(taskId);

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(1);
      }

      if (agentInfo.pr_url && !options.force) {
        const config = getAgentConfig();
        const provider = config.pr_provider === 'auto' ? await detectProvider(projectRoot) : config.pr_provider;

        if (provider) {
          const prStatus = (await getPrStatus(taskId, projectRoot, provider)) as PrStatus | null;
          if (prStatus && prStatus.state !== 'MERGED' && prStatus.state !== 'merged') {
            console.error(`PR is not merged (state: ${prStatus.state}). Use --force to cleanup anyway.`);
            process.exit(1);
          }
        }
      }

      const cleanupResult = cleanupWorktree(taskId, { force: options.force });

      if (cleanupResult.errors.length > 0) {
        for (const err of cleanupResult.errors) {
          console.error(`Failed: ${err}`);
        }
      }

      await updateAgentInDb(taskId, {
        status: 'merged',
        cleaned_at: new Date().toISOString()
      });

      if (options.json) {
        jsonOut({ taskId, ...cleanupResult });
      } else {
        console.log(`Cleaned up ${taskId}: ${cleanupResult.removed.join(', ')}`);
      }
    });

  // worktree:sync
  worktree.command('sync')
    .description('Check PR status, cleanup merged worktrees, update db')
    .option('--dry-run', 'Show what would be done without doing it')
    .option('--json', 'JSON output')
    .action(async (options: SyncOptions) => {
      const projectRoot = findProjectRoot();
      const agents = getAllAgentsFromDb();
      const config = getAgentConfig();
      const provider = config.pr_provider === 'auto' ? await detectProvider(projectRoot) : config.pr_provider;

      const actions: Array<{ action: string; taskId: string; reason: string }> = [];

      for (const [taskId, info] of Object.entries(agents as Record<string, AgentRecord>)) {
        if (info.status === 'merged' || info.status === 'rejected') continue;

        if (info.pr_url && provider) {
          const prStatus = (await getPrStatus(taskId, projectRoot, provider)) as PrStatus | null;
          if (prStatus && (prStatus.state === 'MERGED' || prStatus.state === 'merged')) {
            actions.push({
              action: 'cleanup',
              taskId,
              reason: 'PR merged'
            });
          }
        }

        if (info.worktree) {
          const worktreePath = getWorktreePath(taskId);
          if (!fs.existsSync(worktreePath)) {
            actions.push({
              action: 'update_db',
              taskId,
              reason: 'Worktree missing'
            });
          }
        }
      }

      if (options.json) {
        jsonOut({ actions, dry_run: options.dryRun || false });
      } else if (actions.length === 0) {
        console.log('✓ All worktrees in sync');
      } else {
        console.log('Sync Actions:\n');
        for (const action of actions) {
          const prefix = options.dryRun ? '[DRY-RUN] ' : '';
          console.log(`${prefix}${action.action}: ${action.taskId} (${action.reason})`);

          if (!options.dryRun && action.action === 'cleanup') {
            const cleanupResult = cleanupWorktree(action.taskId, { force: true });
            if (cleanupResult.success) {
              await updateAgentInDb(action.taskId, {
                status: 'merged',
                cleaned_at: new Date().toISOString()
              });
              console.log(`  Cleaned: ${cleanupResult.removed.join(', ')}`);
            } else {
              console.error(`  Failed to cleanup ${action.taskId}: ${cleanupResult.errors.join(', ')}`);
            }
          }
        }
      }
    });
}
