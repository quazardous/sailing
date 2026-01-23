/**
 * Task workflow commands (next, start, done)
 */
import { loadFile, saveFile, jsonOut } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { matchesEpic } from '../../managers/artefacts-manager.js';
import { hasPendingMemoryLogs } from '../../managers/memory-manager.js';
import { isStatusDone, isStatusNotStarted, isStatusCancelled } from '../../lib/lexicon.js';
import { buildDependencyGraph, blockersResolved } from '../../managers/graph-manager.js';
import { parseUpdateOptions, addLogEntry } from '../../lib/update.js';
import { escalateOnTaskStart, cascadeTaskCompletion } from '../../managers/status-manager.js';
import { findTaskFile } from './helpers.js';
import type { Command } from 'commander';
import type {
  TaskNextOptions,
  TaskWithPriority,
  TaskStartOptions,
  TaskDoneOptions
} from '../../lib/types/task-options.js';

/**
 * Register task:next, task:start, task:done commands
 */
export function registerWorkflowCommands(task: Command): void {
  // task:next
  task.command('next')
    .description('Get next ready task (unassigned, unblocked)')
    .option('--prd <id>', 'Filter by PRD (e.g., PRD-006)')
    .option('--epic <id>', 'Filter by epic (e.g., E035)')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((options: TaskNextOptions) => {
      const { tasks } = buildDependencyGraph();

      // Find ready tasks (not started, all blockers done, unassigned)
      const ready: TaskWithPriority[] = [];
      for (const [, graphTask] of tasks) {
        // PRD filter
        if (options.prd) {
          const prdId = options.prd.toUpperCase().replace(/^PRD-?0*/, 'PRD-');
          if (!graphTask.prd?.toUpperCase().includes(prdId.replace('PRD-', ''))) continue;
        }

        // Epic filter (format-agnostic: E1 matches E001)
        if (options.epic) {
          if (!matchesEpic(graphTask.epic, options.epic)) continue;
        }

        if (isStatusNotStarted(graphTask.status) &&
            graphTask.assignee === 'unassigned' &&
            blockersResolved(graphTask, tasks)) {
          ready.push({
            id: graphTask.id,
            title: graphTask.title,
            status: graphTask.status,
            parent: graphTask.parent,
            assignee: graphTask.assignee,
            priority: graphTask.priority,
            prd: graphTask.prd,
            file: graphTask.file
          });
        }
      }

      if (ready.length === 0) {
        if (options.json) {
          jsonOut({ task: null, message: 'No ready tasks' });
        } else {
          console.log('No ready tasks available.');
        }
        return;
      }

      // Sort by priority and ID
      const priorityOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
      ready.sort((a, b) => {
        const pa = (priorityOrder[a.priority]) ?? 2;
        const pb = (priorityOrder[b.priority]) ?? 2;
        if (pa !== pb) return pa - pb;
        const numA = parseInt(a.id.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.id.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

      const next = ready[0];

      // Check for pending memory (preflight)
      let pendingWarning = null;
      if (hasPendingMemoryLogs()) {
        pendingWarning = `⚠ PENDING LOGS: epic(s) need consolidation`;
      }

      if (options.json) {
        const output: Record<string, unknown> = { ...next, pendingMemory: !!pendingWarning };
        if (!options.path) delete output.file;
        jsonOut(output);
      } else {
        // Show warning first if pending
        if (pendingWarning) {
          console.log(pendingWarning);
          console.log(`→ Run: rudder memory:sync`);
          console.log(`→ Follow the aggregation instructions shown\n`);
        }

        console.log(`${next.id}: ${next.title}`);
        console.log(`PRD: ${next.prd}`);
        if (options.path) console.log(`File: ${next.file}`);
        if (ready.length > 1) {
          console.log(`\n${ready.length - 1} more ready task(s)`);
        }
      }
    });

  // task:start - composite command
  task.command('start <id>')
    .description('Start task → sets In Progress + assignee, checks blockers')
    .option('-a, --assignee <name>', 'Assignee name', 'agent')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((id: string, options: TaskStartOptions) => {
      const taskFile = findTaskFile(id);
      if (!taskFile) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      const file = loadFile(taskFile);
      const { tasks } = buildDependencyGraph();
      const normalizedId = normalizeId(id);
      const graphTask = tasks.get(normalizedId);

      // Check blockers
      if (graphTask && !blockersResolved(graphTask, tasks)) {
        const pending = graphTask.blockedBy.filter(b => {
          const blocker = tasks.get(b);
          return blocker && !isStatusDone(blocker.status) && !isStatusCancelled(blocker.status);
        });
        console.error(`Task ${id} is blocked by: ${pending.join(', ')}`);
        process.exit(1);
      }

      // Update status and assignee
      const opts = { status: 'In Progress', assignee: options.assignee };
      const { data } = parseUpdateOptions(opts, file.data, 'task') as { updated: boolean; data: Record<string, unknown> };
      saveFile(taskFile, data, file.body);

      // Auto-escalate: Epic and PRD to In Progress if not started
      const escalation = escalateOnTaskStart(data);
      if (escalation.epic?.updated) {
        console.log(`● ${escalation.epic.message}`);
      }
      if (escalation.prd?.updated) {
        console.log(`● ${escalation.prd.message}`);
      }

      if (options.json) {
        const output: Record<string, unknown> = { ...data };
        if (options.path) output.file = taskFile;
        jsonOut(output);
      } else {
        console.log(`Started: ${data.id} - ${data.title}`);
        console.log(`Status: ${data.status}`);
        console.log(`Assignee: ${data.assignee}`);
        if (options.path) console.log(`\nFile: ${taskFile}`);
      }
    });

  // task:done - composite command
  task.command('done <id>')
    .description('Complete task → sets Done + adds log entry')
    .option('-m, --message <msg>', 'Log message', 'Completed')
    .option('--json', 'JSON output')
    .action((id: string, options: TaskDoneOptions) => {
      const taskFile = findTaskFile(id);
      if (!taskFile) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      const file = loadFile(taskFile);

      // Update status
      const opts = { status: 'Done' };
      const { data } = parseUpdateOptions(opts, file.data, 'task') as { updated: boolean; data: Record<string, unknown> };

      // Add log entry
      const body = addLogEntry(file.body, options.message, (data.assignee as string) || 'agent');

      saveFile(taskFile, data, body);

      // Cascade completion: check if Epic/PRD should be Auto-Done
      const cascade = cascadeTaskCompletion(id, data);
      if (cascade.epic?.updated) {
        console.log(`\n◉ ${cascade.epic.message}`);
      }
      if (cascade.prd?.updated) {
        console.log(`◉ ${cascade.prd.message}`);
      }

      if (options.json) {
        jsonOut(data);
      } else {
        console.log(`Completed: ${data.id} - ${data.title}`);
      }
    });
}
