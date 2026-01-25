/**
 * Worktree PR command
 */
import { execSync } from 'child_process';
import { findProjectRoot, jsonOut } from '../../managers/core-manager.js';
import { getAgentFromDb, updateAgentInDb } from '../../managers/db-manager.js';
import { getAgentConfig } from '../../managers/core-manager.js';
import { getWorktreePath, getMainBranch as getConfiguredMainBranch } from '../../managers/worktree-manager.js';
import { detectProvider, checkCli as checkPrCli } from '../../managers/pr-manager.js';
import { createPr } from './helpers.js';
/**
 * Register worktree:pr command
 */
export function registerPrCommand(worktree) {
    worktree.command('pr <task-id>')
        .description('Push branch and create PR/MR for agent work')
        .option('--draft', 'Create as draft PR')
        .option('--json', 'JSON output')
        .action(async (taskIdParam, options) => {
        let taskId = taskIdParam.toUpperCase();
        if (!taskId.startsWith('T'))
            taskId = 'T' + taskId;
        const projectRoot = findProjectRoot();
        const agentInfo = getAgentFromDb(taskId);
        if (!agentInfo) {
            console.error(`No agent found for task: ${taskId}`);
            process.exit(1);
        }
        if (!agentInfo.worktree) {
            console.error(`Task ${taskId} has no worktree`);
            process.exit(1);
        }
        if (agentInfo.pr_url) {
            console.log(`PR already exists: ${agentInfo.pr_url}`);
            return;
        }
        const config = getAgentConfig();
        const provider = config.pr_provider === 'auto' ? await detectProvider(projectRoot) : config.pr_provider;
        if (!provider) {
            console.error('Cannot detect PR provider. Set agent.pr_provider in config.');
            process.exit(1);
        }
        const cli = checkPrCli(provider);
        if (!cli.available) {
            console.error(`${cli.cmd} CLI not found. Install it to create PRs.`);
            process.exit(1);
        }
        const worktreePath = getWorktreePath(taskId);
        const mainBranch = getConfiguredMainBranch();
        try {
            const count = execSync(`git rev-list --count HEAD ^${mainBranch}`, {
                cwd: worktreePath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
            if (parseInt(count, 10) === 0) {
                console.error('No commits to create PR from');
                process.exit(1);
            }
        }
        catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`Cannot check commits: ${errorMessage}`);
            process.exit(1);
        }
        try {
            const pr = await createPr(taskId, options, projectRoot);
            await updateAgentInDb(taskId, {
                pr_url: pr.url,
                pr_created_at: new Date().toISOString()
            });
            if (options.json) {
                jsonOut({ taskId, ...pr });
            }
            else {
                console.log(`PR created: ${pr.url}`);
            }
        }
        catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(errorMessage);
            process.exit(1);
        }
    });
}
