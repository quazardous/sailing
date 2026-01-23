/**
 * Assignment management commands (complete, delete)
 */
import fs from 'fs';
import yaml from 'js-yaml';
import { Command } from 'commander';
import { jsonOut } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { withModifies } from '../../lib/help.js';
import { assignmentPath } from './helpers.js';
import type { AssignmentData } from './helpers.js';

/**
 * Register assignment management commands
 */
export function registerManageCommands(assign: Command): void {
  // assign:complete TNNN
  withModifies(assign.command('complete <task-id>'), ['task'])
    .description('Mark an assignment as complete')
    .option('--success', 'Mark as successful completion')
    .option('--failure', 'Mark as failed completion')
    .option('--json', 'JSON output')
    .action((taskId: string, options: { success?: boolean; failure?: boolean; json?: boolean }) => {
      const normalized = normalizeId(taskId);
      const filePath = assignmentPath(normalized);

      if (!fs.existsSync(filePath)) {
        console.error(`No assignment found for ${normalized}`);
        process.exit(1);
      }

      const assignment = yaml.load(fs.readFileSync(filePath, 'utf8')) as AssignmentData;

      if (assignment.status === 'complete') {
        console.error(`Assignment already complete at ${assignment.completed_at}`);
        process.exit(1);
      }

      assignment.status = 'complete';
      assignment.completed_at = new Date().toISOString();
      assignment.success = options.failure ? false : true;

      fs.writeFileSync(filePath, yaml.dump(assignment));

      if (options.json) {
        jsonOut(assignment);
        return;
      }

      const result = assignment.success ? 'successfully' : 'with failure';
      console.log(`Assignment ${normalized} completed ${result}`);
    });

  // assign:delete TNNN
  withModifies(assign.command('delete <task-id>'), ['task'])
    .description('Delete an assignment')
    .option('--force', 'Force delete even if claimed')
    .option('--json', 'JSON output')
    .action((taskId: string, options: { force?: boolean; json?: boolean }) => {
      const normalized = normalizeId(taskId);
      const filePath = assignmentPath(normalized);

      if (!fs.existsSync(filePath)) {
        console.error(`No assignment found for ${normalized}`);
        process.exit(1);
      }

      const assignment = yaml.load(fs.readFileSync(filePath, 'utf8')) as AssignmentData;

      if (assignment.status === 'claimed' && !options.force) {
        console.error(`Assignment is claimed. Use --force to delete.`);
        process.exit(1);
      }

      fs.unlinkSync(filePath);

      if (options.json) {
        jsonOut({ deleted: normalized });
        return;
      }

      console.log(`Deleted assignment: ${normalized}`);
    });
}
