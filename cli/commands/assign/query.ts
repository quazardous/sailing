/**
 * Assignment query commands (show, list)
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Command } from 'commander';
import { jsonOut, getAssignmentsDir, computeProjectHash } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { assignmentPath, timeSince } from './helpers.js';
import type { AssignmentData } from './helpers.js';

/**
 * Register assignment query commands
 */
export function registerQueryCommands(assign: Command): void {
  // assign:show TNNN
  assign.command('show <task-id>')
    .option('--json', 'JSON output')
    .action((taskId: string, options: { json?: boolean }) => {
      const normalized = normalizeId(taskId);
      const filePath = assignmentPath(normalized);

      if (!fs.existsSync(filePath)) {
        console.error(`No assignment found for ${normalized}`);
        process.exit(1);
      }

      const assignment = yaml.load(fs.readFileSync(filePath, 'utf8')) as AssignmentData;

      if (options.json) {
        jsonOut(assignment);
        return;
      }

      console.log(`Assignment: ${normalized}`);
      console.log(`  Status: ${assignment.status}`);
      console.log(`  Operation: ${assignment.operation}`);
      console.log(`  Epic: ${assignment.epicId || 'none'}`);
      console.log(`  Created: ${assignment.created_at}`);
      if (assignment.claimed_at) {
        console.log(`  Claimed: ${assignment.claimed_at}`);
      }
      if (assignment.completed_at) {
        console.log(`  Completed: ${assignment.completed_at}`);
      }
    });

  // assign:list
  assign.command('list')
    .description('List all assignments')
    .option('--status <status>', 'Filter by status (pending, claimed, complete)')
    .option('--json', 'JSON output')
    .action((options: { status?: string; json?: boolean }) => {
      const dir = getAssignmentsDir();
      if (!fs.existsSync(dir)) {
        if (options.json) {
          jsonOut([]);
        } else {
          console.log('No assignments found');
        }
        return;
      }

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));

      const projectHash = computeProjectHash();
      const assignments: (AssignmentData & { projectHash?: string; created_at: string })[] = [];

      for (const file of files) {
        const content = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8')) as AssignmentData & { projectHash?: string; created_at: string };

        // Only show assignments for current project
        if (content.projectHash && content.projectHash !== projectHash) {
          continue;
        }

        // Filter by status if specified
        if (options.status && content.status !== options.status) {
          continue;
        }

        assignments.push(content);
      }

      if (options.json) {
        jsonOut(assignments);
        return;
      }

      if (assignments.length === 0) {
        console.log('No assignments found');
        return;
      }

      console.log(`Assignments (${assignments.length}):\n`);
      for (const a of assignments) {
        const age = a.claimed_at
          ? `claimed ${timeSince(new Date(a.claimed_at))}`
          : `created ${timeSince(new Date(a.created_at))}`;
        console.log(`  ${a.taskId}  ${(a.status || '').padEnd(8)}  ${(a.operation || '').padEnd(12)}  ${age}`);
      }
    });
}
