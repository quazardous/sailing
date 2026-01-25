import { jsonOut } from '../../managers/core-manager.js';
import { getAgentConfig } from '../../managers/core-manager.js';
import { diagnose as diagnoseReconciliation, diagnoseWorktrees as diagnoseWorktreesReconciliation, reconcileBranch, pruneOrphans, report as reconciliationReport, BranchState } from '../../managers/reconciliation-manager.js';
/**
 * Register worktree:reconcile command
 */
export function registerReconcileCommand(worktree) {
    worktree.command('reconcile')
        .description('Diagnose and reconcile branch state (sync, prune orphans)')
        .option('--prd <id>', 'PRD ID for context')
        .option('--epic <id>', 'Epic ID for context')
        .option('--sync', 'Sync branches that are behind')
        .option('--prune', 'Prune orphaned branches')
        .option('--force', 'Force prune even if not fully merged')
        .option('--dry-run', 'Show what would be done without doing it')
        .option('--json', 'JSON output')
        .action((options) => {
        const context = {
            prdId: options.prd,
            epicId: options.epic,
            branching: 'flat'
        };
        const diag = diagnoseReconciliation(context);
        const wtDiag = diagnoseWorktreesReconciliation();
        if (!options.sync && !options.prune) {
            if (options.json) {
                jsonOut({
                    diagnosis: diag,
                    worktrees: wtDiag,
                    hasIssues: diag.issues.length > 0 || wtDiag.issues.length > 0
                });
            }
            else {
                console.log(reconciliationReport(context));
            }
            return;
        }
        const results = {
            synced: [],
            pruned: [],
            errors: []
        };
        if (options.sync) {
            for (const h of diag.hierarchy) {
                if (typeof h !== 'object' || !('branch' in h))
                    continue;
                const branchInfo = h;
                if (branchInfo.state === BranchState.BEHIND || branchInfo.state === BranchState.DIVERGED) {
                    const agentConfig = getAgentConfig();
                    const result = reconcileBranch(branchInfo.branch, branchInfo.parent, {
                        strategy: agentConfig?.merge_strategy || 'merge',
                        dryRun: options.dryRun || false
                    });
                    if (result.success && result.action === 'synced') {
                        results.synced.push(`${branchInfo.branch} ← ${branchInfo.parent}`);
                    }
                    else if (result.action === 'would_sync') {
                        results.synced.push(`[dry-run] ${branchInfo.branch} ← ${branchInfo.parent}`);
                    }
                    else if (!result.success) {
                        results.errors.push(`${branchInfo.branch}: ${result.error}`);
                    }
                }
            }
        }
        if (options.prune) {
            const pruneResult = pruneOrphans({
                dryRun: options.dryRun || false,
                force: options.force || false
            });
            results.pruned = pruneResult.pruned.map(b => options.dryRun ? `[dry-run] ${b}` : b);
            results.errors.push(...pruneResult.errors);
        }
        if (options.json) {
            jsonOut({
                success: results.errors.length === 0,
                synced: results.synced,
                pruned: results.pruned,
                errors: results.errors
            });
        }
        else {
            if (results.synced.length > 0) {
                console.log('Synced branches:');
                results.synced.forEach(s => console.log(`  ✓ ${s}`));
            }
            if (results.pruned.length > 0) {
                console.log('Pruned branches:');
                results.pruned.forEach(p => console.log(`  ✓ ${p}`));
            }
            if (results.errors.length > 0) {
                console.log('Errors:');
                results.errors.forEach(e => console.log(`  ✗ ${e}`));
            }
            if (results.synced.length === 0 && results.pruned.length === 0 && results.errors.length === 0) {
                console.log('✓ Everything is in sync, no orphans found.');
            }
        }
    });
}
