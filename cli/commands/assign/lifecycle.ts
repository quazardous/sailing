/**
 * Assignment lifecycle commands (create, claim, release)
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Command } from 'commander';
import { jsonOut, loadFile, saveFile, getAssignmentsDir, ensureDir, computeProjectHash } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { withModifies } from '../../lib/help.js';
import { countTaskTips } from '../../managers/memory-manager.js';
import { checkPosts, formatPostOutput } from '../../lib/guards.js';
import {
  findTaskFile,
  detectEntityType,
  isRunning,
  removeRunFile,
  logToTask,
  assignmentPath,
  handleTaskClaim,
  handleEpicClaim,
  handlePrdClaim
} from './helpers.js';
import type { AssignmentData } from './helpers.js';

/**
 * Register assignment lifecycle commands
 */
export function registerLifecycleCommands(assign: Command): void {
  // assign:create TNNN --operation <op>
  withModifies(assign.command('create <task-id>'), ['task'])
    .description('Create an assignment for a task')
    .requiredOption('--operation <op>', 'Operation type (task-start, etc.)')
    .option('--path', 'Show file path (discouraged)')
    .option('--json', 'JSON output')
    .action((taskId: string, options: { operation: string; path?: boolean; json?: boolean }) => {
      const normalized = normalizeId(taskId);

      // Validate task exists
      const taskFile = findTaskFile(normalized);
      if (!taskFile) {
        console.error(`Task not found: ${normalized}`);
        process.exit(1);
      }

      const file = loadFile(taskFile);
      const parent = (file.data?.parent as string | undefined) || '';
      const epicMatch = parent.match(/E(\d+)/i);
      const epicId = epicMatch ? normalizeId(`E${epicMatch[1]}`) : null;

      const filePath = assignmentPath(normalized);

      // Check if assignment already exists
      if (fs.existsSync(filePath)) {
        const existing = yaml.load(fs.readFileSync(filePath, 'utf8')) as AssignmentData;
        if (existing.status !== 'complete') {
          console.error(`Assignment already exists for ${normalized} (status: ${existing.status})`);
          process.exit(1);
        }
      }

      const assignment = {
        taskId: normalized,
        epicId,
        operation: options.operation,
        status: 'pending',
        created_at: new Date().toISOString(),
        claimed_at: null,
        completed_at: null,
        projectHash: computeProjectHash()
      };

      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, yaml.dump(assignment));

      if (options.json) {
        const output: Record<string, unknown> = { ...assignment };
        if (options.path) output.file = filePath;
        jsonOut(output);
      } else {
        console.log(`Created assignment: ${normalized}`);
        console.log(`  Operation: ${options.operation}`);
        if (options.path) console.log(`  Path: ${filePath}`);
      }
    });

  // assign:claim <entity-id> - unified context for tasks, epics, PRDs
  withModifies(assign.command('claim <entity-id>'), ['task'])
    .description('Get compiled prompt for any entity (task, epic, or PRD)')
    .requiredOption('--role <role>', 'Role context (required): only "agent" allowed')
    .option('--operation <op>', 'Operation type (auto-detected if not specified)')
    .option('--approach <text>', 'Approach description for auto-log (tasks only)')
    .option('--force', 'Force claim even with orphan runs or pending memory')
    .option('--sources', 'Show fragment sources used')
    .option('--debug', 'Add source comments to each section')
    .option('--json', 'JSON output')
    .action(async (entityId: string, options: {
      role: string;
      operation?: string;
      approach?: string;
      force?: boolean;
      sources?: boolean;
      debug?: boolean;
      json?: boolean;
    }) => {
      // Role enforcement: only agents claim - skill/coordinator MUST spawn an agent
      if (options.role !== 'agent') {
        console.error(`ERROR: assign:claim requires --role agent`);
        console.error(`\nReceived: --role ${options.role}`);
        console.error(`\nSkill/coordinator MUST spawn an inline agent (Task tool) that calls:`);
        console.error(`  assign:claim ${entityId} --role agent`);
        console.error(`\nDo NOT call assign:claim directly - it pollutes your context with agent prompts.`);
        process.exit(1);
      }

      const entity = detectEntityType(entityId);

      if (entity.type === 'unknown') {
        console.error(`Unknown entity type: ${entityId}`);
        console.error(`Expected: TNNN (task), ENNN (epic), or PRD-NNN`);
        process.exit(1);
      }

      // Route to appropriate handler
      if (entity.type === 'task') {
        await handleTaskClaim(entity.id, options);
      } else if (entity.type === 'epic') {
        handleEpicClaim(entity.id, options);
      } else if (entity.type === 'prd') {
        handlePrdClaim(entity.id, options);
      }
    });

  // assign:release TNNN
  withModifies(assign.command('release <task-id>'), ['task'])
    .description('Release assignment (agent finished)')
    .option('--status <status>', 'Task completion status (Done or Blocked)', 'Done')
    .option('--json', 'JSON output')
    .action(async (taskId: string, options: { status: string; json?: boolean }) => {
      const normalized = normalizeId(taskId);

      // Check if run file exists
      if (!isRunning(normalized)) {
        console.error(`No active run for ${normalized}`);
        console.error(`Use assign:claim first to start.`);
        process.exit(1);
      }

      // Count TIP logs for post-prompt
      const tipCount = countTaskTips(normalized);

      // Auto-log completion
      logToTask(normalized, 'Completed', 'INFO');

      // Update task status
      const taskFile = findTaskFile(normalized);
      if (taskFile) {
        const file = loadFile(taskFile);
        const newStatus = options.status === 'Blocked' ? 'Blocked' : 'Done';
        file.data.status = newStatus;
        if (newStatus === 'Done') {
          file.data.done_at = new Date().toISOString();
        }
        saveFile(taskFile, file.data, file.body || '');
      }

      // Remove run file
      removeRunFile(normalized);

      // Update assignment file if tracked
      const assignPath = assignmentPath(normalized);
      if (fs.existsSync(assignPath)) {
        const assignment = yaml.load(fs.readFileSync(assignPath, 'utf8')) as AssignmentData;
        assignment.status = 'complete';
        assignment.completed_at = new Date().toISOString();
        assignment.success = options.status !== 'Blocked';
        fs.writeFileSync(assignPath, yaml.dump(assignment));
      }

      if (options.json) {
        jsonOut({
          taskId: normalized,
          status: options.status,
          tipCount,
          released: true
        });
        return;
      }

      console.log(`✓ Released ${normalized} (${options.status})`);
      console.log(`  ${tipCount} TIP log(s) recorded`);

      // Post-prompts (via guards)
      const posts = await checkPosts('assign:release', {
        taskId: normalized,
        hasTipLogs: tipCount > 0
      }, process.cwd());
      const postOutput = formatPostOutput(posts);
      if (postOutput) {
        console.log(postOutput);
      }
    });
}
