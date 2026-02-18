/**
 * Archive command - Archive completed PRDs with their memory files
 *
 * Usage:
 *   rudder archive PRD-001          # Archive PRD (must be done)
 *   rudder archive PRD-001 --force  # Archive even if not done
 *   rudder archive PRD-001 --dry-run # Show what would be archived
 */
import path from 'path';
import { archivePrd, getDonePrds, isPrdDone, getPrdStatus } from '../managers/archive-manager.js';
import { getPrd } from '../managers/artefacts-manager.js';
import { withModifies } from '../lib/help.js';
/**
 * List PRDs that are Done (ready to archive)
 */
function listDonePrds() {
    const donePrds = getDonePrds();
    if (donePrds.length === 0) {
        console.log('No PRDs with status Done');
        return;
    }
    console.log(`PRDs ready to archive (${donePrds.length}):\n`);
    for (const prd of donePrds) {
        const title = prd.data?.title || path.basename(prd.dir);
        console.log(`  ${prd.id}: ${title}`);
    }
    console.log();
    console.log('Use: rudder archive <prd-id> [--dry-run]');
}
/**
 * Archive a PRD (CLI wrapper with console output)
 */
async function archivePrdCli(prdId, options) {
    const { force = false, dryRun = false } = options;
    if (dryRun) {
        // Show detailed dry-run preview
        const prd = getPrd(prdId);
        if (!prd) {
            console.error(`\u2717 PRD not found: ${prdId}`);
            process.exit(1);
        }
        const isDone = isPrdDone(prd.dir);
        console.log('=== Dry Run ===');
        console.log();
        console.log(`PRD folder:`);
        console.log(`  ${prd.dir}`);
        console.log();
        if (!isDone) {
            const status = getPrdStatus(prd.dir);
            console.log(`\u26A0 PRD is not done (status: ${status})`);
            console.log();
        }
        console.log(`(dry-run mode, no changes made)`);
        return;
    }
    const result = await archivePrd(prdId, { force, dryRun: false });
    if (!result.success) {
        console.error(`\u2717 ${result.error}`);
        process.exit(1);
    }
    console.log(`\u2713 ${result.prdId} archived successfully`);
    if (result.movedFiles && result.movedFiles.length > 0) {
        console.log(`  Moved ${result.movedFiles.length} items`);
    }
}
/**
 * Archive all Done PRDs
 */
async function archiveAllDone(dryRun = false) {
    const donePrds = getDonePrds();
    if (donePrds.length === 0) {
        console.log('No PRDs with status Done');
        return;
    }
    console.log(`${dryRun ? '=== Dry Run ===' : '=== Archiving all Done PRDs ==='}\n`);
    for (const prd of donePrds) {
        console.log(`--- ${prd.id} ---`);
        await archivePrdCli(prd.id, { force: false, dryRun });
        console.log();
    }
}
/**
 * Register archive commands
 */
export function registerArchiveCommands(program) {
    withModifies(program
        .command('archive [prd-id]'), ['prd', 'git'])
        .description('Archive a completed PRD (or list Done PRDs if no ID)')
        .option('--list', 'List PRDs with status Done (default if no ID)')
        .option('--all', 'Archive all Done PRDs')
        .option('--force', 'Archive even if PRD is not done')
        .option('--dry-run', 'Show what would be archived without doing it')
        .action(async (prdId, options) => {
        if (options.all) {
            if (options.force) {
                console.error('\u2717 --all and --force are incompatible');
                process.exit(1);
            }
            await archiveAllDone(options.dryRun || false);
            return;
        }
        if (!prdId || options.list) {
            listDonePrds();
            return;
        }
        await archivePrdCli(prdId, {
            force: options.force || false,
            dryRun: options.dryRun || false
        });
    });
}
