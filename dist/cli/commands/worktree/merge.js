/**
 * Worktree merge commands (merge, promote)
 */
import fs from 'fs';
import { execSync } from 'child_process';
import { findProjectRoot, jsonOut } from '../../managers/core-manager.js';
import { getAgentFromDb, updateAgentInDb } from '../../managers/db-manager.js';
import { getGitConfig } from '../../managers/core-manager.js';
import { getWorktreePath, getBranchName, removeWorktree, branchExists, getParentBranch, getMainBranch as getConfiguredMainBranch } from '../../managers/worktree-manager.js';
import { getTask } from '../../managers/artefacts-manager.js';
import { extractPrdId, extractEpicId } from '../../lib/normalize.js';
/**
 * Register worktree:merge and worktree:promote commands
 */
export function registerMergeCommands(worktree) {
    // worktree:merge
    worktree.command('merge <task-id>')
        .description('Merge task branch to parent branch (local git workflow)')
        .option('--strategy <type>', 'Merge strategy: merge|squash|rebase (default from config)')
        .option('--no-cleanup', 'Keep worktree after merge')
        .option('--dry-run', 'Show what would be done without doing it')
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
        const worktreePath = getWorktreePath(taskId);
        if (!fs.existsSync(worktreePath)) {
            console.error(`Worktree not found: ${worktreePath}`);
            process.exit(1);
        }
        const branching = agentInfo.worktree.branching || 'flat';
        const taskInfo = getTask(taskId);
        const prdId = taskInfo?.data?.parent ? extractPrdId(taskInfo.data.parent) : undefined;
        const epicId = taskInfo?.data?.parent ? extractEpicId(taskInfo.data.parent) : undefined;
        const branchContext = { prdId, epicId, branching };
        const taskBranch = getBranchName(taskId);
        const parentBranch = getParentBranch(taskId, branchContext);
        const gitConfig = getGitConfig();
        let strategy = options.strategy || '';
        if (!strategy) {
            if (branching === 'flat') {
                strategy = gitConfig.merge_to_main || 'squash';
            }
            else if (branching === 'prd') {
                strategy = gitConfig.merge_to_prd || 'squash';
            }
            else if (branching === 'epic') {
                strategy = gitConfig.merge_to_epic || 'merge';
            }
            else {
                strategy = 'merge';
            }
        }
        const validStrategies = ['merge', 'squash', 'rebase'];
        if (!validStrategies.includes(strategy)) {
            console.error(`Invalid merge strategy: ${strategy}`);
            console.error(`Valid strategies: ${validStrategies.join(', ')}`);
            process.exit(1);
        }
        if (!branchExists(parentBranch)) {
            console.error(`Parent branch not found: ${parentBranch}`);
            console.error('Create it first or check branching strategy in PRD.');
            process.exit(1);
        }
        try {
            const status = execSync('git status --porcelain', {
                cwd: worktreePath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
            if (status) {
                console.error('Worktree has uncommitted changes:');
                status.split('\n').slice(0, 5).forEach(l => console.error(`  ${l}`));
                console.error('\nCommit changes first or use agent:reject to discard.');
                process.exit(1);
            }
        }
        catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`Cannot check worktree status: ${errorMessage}`);
            process.exit(1);
        }
        let commitCount = 0;
        try {
            commitCount = parseInt(execSync(`git rev-list --count ${parentBranch}..${taskBranch}`, {
                cwd: projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            }).trim(), 10) || 0;
        }
        catch {
            commitCount = 0;
        }
        if (commitCount === 0) {
            console.log(`No commits to merge from ${taskBranch} to ${parentBranch}`);
            return;
        }
        if (options.dryRun) {
            console.log('Merge (dry run):\n');
            console.log(`  Task branch: ${taskBranch}`);
            console.log(`  Parent branch: ${parentBranch}`);
            console.log(`  Strategy: ${strategy}`);
            console.log(`  Commits: ${commitCount}`);
            console.log(`  Cleanup: ${options.cleanup !== false ? 'yes' : 'no'}`);
            return;
        }
        try {
            execSync(`git checkout ${parentBranch}`, {
                cwd: projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
        }
        catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`Failed to checkout ${parentBranch}: ${errorMessage}`);
            process.exit(1);
        }
        let mergeSuccess = false;
        try {
            if (strategy === 'merge') {
                execSync(`git merge ${taskBranch} --no-edit -m "Merge ${taskId} into ${parentBranch}"`, {
                    cwd: projectRoot,
                    encoding: 'utf8',
                    stdio: options.json ? ['pipe', 'pipe', 'pipe'] : 'inherit'
                });
                mergeSuccess = true;
            }
            else if (strategy === 'squash') {
                execSync(`git merge --squash ${taskBranch}`, {
                    cwd: projectRoot,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                execSync(`git commit -m "${taskId}: squashed merge from ${taskBranch}"`, {
                    cwd: projectRoot,
                    encoding: 'utf8',
                    stdio: options.json ? ['pipe', 'pipe', 'pipe'] : 'inherit'
                });
                mergeSuccess = true;
            }
            else if (strategy === 'rebase') {
                execSync(`git rebase ${taskBranch}`, {
                    cwd: projectRoot,
                    encoding: 'utf8',
                    stdio: options.json ? ['pipe', 'pipe', 'pipe'] : 'inherit'
                });
                mergeSuccess = true;
            }
        }
        catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`Merge failed: ${errorMessage}`);
            console.error('\nResolve conflicts manually or use /dev:merge skill.');
            try {
                if (strategy === 'rebase') {
                    execSync('git rebase --abort', { cwd: projectRoot, stdio: 'pipe' });
                }
                else {
                    execSync('git merge --abort', { cwd: projectRoot, stdio: 'pipe' });
                }
            }
            catch { /* ignore */ }
            process.exit(1);
        }
        let cleaned = false;
        if (mergeSuccess && options.cleanup !== false) {
            const removeResult = removeWorktree(taskId, { force: true });
            cleaned = removeResult.success;
        }
        const updates = {
            status: 'merged',
            merge_strategy: strategy,
            merged_to: parentBranch,
            merged_at: new Date().toISOString()
        };
        if (cleaned) {
            updates.cleaned_at = new Date().toISOString();
        }
        await updateAgentInDb(taskId, updates);
        const result = {
            taskId,
            status: 'merged',
            from: taskBranch,
            to: parentBranch,
            strategy,
            commits: commitCount,
            cleaned
        };
        if (options.json) {
            jsonOut(result);
        }
        else {
            console.log(`\n✓ Merged: ${taskBranch} → ${parentBranch}`);
            console.log(`  Strategy: ${strategy}`);
            console.log(`  Commits: ${commitCount}`);
            if (cleaned) {
                console.log(`  Worktree cleaned up`);
            }
            if (branching !== 'flat') {
                if (branching === 'epic') {
                    console.log(`\nNext: When epic is complete, merge epic/${epicId} to prd/${prdId}`);
                }
                else if (branching === 'prd') {
                    console.log(`\nNext: When PRD is complete, merge prd/${prdId} to main`);
                }
            }
        }
    });
    // worktree:promote
    worktree.command('promote <level> <id>')
        .description('Merge epic→prd or prd→main (e.g., promote epic E001 --prd PRD-001, promote prd PRD-001)')
        .option('--prd <prd-id>', 'PRD ID (required for epic level)')
        .option('--strategy <type>', 'Merge strategy: merge|squash|rebase (default from config)')
        .option('--dry-run', 'Show what would be done without doing it')
        .option('--json', 'JSON output')
        .action((levelParam, idParam, options) => {
        const level = levelParam.toLowerCase();
        const id = idParam.toUpperCase();
        if (!['epic', 'prd'].includes(level)) {
            console.error(`Invalid level: ${level}. Use 'epic' or 'prd'.`);
            process.exit(1);
        }
        const projectRoot = findProjectRoot();
        const gitConfig = getGitConfig();
        const mainBranch = getConfiguredMainBranch();
        let sourceBranch;
        let targetBranch;
        let strategy;
        if (level === 'epic') {
            const epicId = id.startsWith('E') ? id : `E${id}`;
            sourceBranch = `epic/${epicId}`;
            let prdId = options.prd;
            if (!prdId) {
                console.error('Epic promote requires --prd option.');
                console.error('Usage: worktree promote epic E001 --prd PRD-001');
                process.exit(1);
            }
            prdId = prdId.toUpperCase();
            if (!prdId.startsWith('PRD-')) {
                prdId = `PRD-${prdId}`;
            }
            targetBranch = `prd/${prdId}`;
            strategy = options.strategy || gitConfig.merge_to_prd || 'squash';
        }
        else {
            const prdId = id.startsWith('PRD-') ? id : `PRD-${id}`;
            sourceBranch = `prd/${prdId}`;
            targetBranch = mainBranch;
            strategy = options.strategy || gitConfig.merge_to_main || 'squash';
        }
        if (!branchExists(sourceBranch)) {
            console.error(`Source branch not found: ${sourceBranch}`);
            process.exit(1);
        }
        if (!branchExists(targetBranch)) {
            console.error(`Target branch not found: ${targetBranch}`);
            process.exit(1);
        }
        let commitCount = 0;
        try {
            commitCount = parseInt(execSync(`git rev-list --count ${targetBranch}..${sourceBranch}`, {
                cwd: projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            }).trim(), 10) || 0;
        }
        catch {
            commitCount = 0;
        }
        if (commitCount === 0) {
            console.log(`No commits to merge from ${sourceBranch} to ${targetBranch}`);
            return;
        }
        if (options.dryRun) {
            console.log('Promote (dry run):\n');
            console.log(`  Source: ${sourceBranch}`);
            console.log(`  Target: ${targetBranch}`);
            console.log(`  Strategy: ${strategy}`);
            console.log(`  Commits: ${commitCount}`);
            return;
        }
        try {
            execSync(`git checkout ${targetBranch}`, {
                cwd: projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
        }
        catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`Failed to checkout ${targetBranch}: ${errorMessage}`);
            process.exit(1);
        }
        let mergeSuccess = false;
        try {
            if (strategy === 'merge') {
                execSync(`git merge ${sourceBranch} --no-edit -m "Merge ${sourceBranch} into ${targetBranch}"`, {
                    cwd: projectRoot,
                    encoding: 'utf8',
                    stdio: options.json ? ['pipe', 'pipe', 'pipe'] : 'inherit'
                });
                mergeSuccess = true;
            }
            else if (strategy === 'squash') {
                execSync(`git merge --squash ${sourceBranch}`, {
                    cwd: projectRoot,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                const commitMsg = level === 'epic'
                    ? `${id}: squashed merge of epic`
                    : `${id}: squashed merge of PRD`;
                execSync(`git commit -m "${commitMsg}"`, {
                    cwd: projectRoot,
                    encoding: 'utf8',
                    stdio: options.json ? ['pipe', 'pipe', 'pipe'] : 'inherit'
                });
                mergeSuccess = true;
            }
            else if (strategy === 'rebase') {
                execSync(`git rebase ${sourceBranch}`, {
                    cwd: projectRoot,
                    encoding: 'utf8',
                    stdio: options.json ? ['pipe', 'pipe', 'pipe'] : 'inherit'
                });
                mergeSuccess = true;
            }
        }
        catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`Merge failed: ${errorMessage}`);
            console.error('\nResolve conflicts manually or use /dev:merge skill.');
            try {
                if (strategy === 'rebase') {
                    execSync('git rebase --abort', { cwd: projectRoot, stdio: 'pipe' });
                }
                else {
                    execSync('git merge --abort', { cwd: projectRoot, stdio: 'pipe' });
                }
            }
            catch { /* ignore */ }
            process.exit(1);
        }
        const result = {
            level,
            id,
            from: sourceBranch,
            to: targetBranch,
            strategy,
            commits: commitCount,
            success: mergeSuccess
        };
        if (options.json) {
            jsonOut(result);
        }
        else {
            console.log(`\n✓ Promoted: ${sourceBranch} → ${targetBranch}`);
            console.log(`  Strategy: ${strategy}`);
            console.log(`  Commits: ${commitCount}`);
            if (level === 'epic') {
                console.log(`\nNext: When all epics complete, promote prd to main`);
            }
            else {
                console.log(`\n✓ PRD merged to main. Ready for release.`);
            }
        }
    });
}
