/**
 * Task list command
 */
import path from 'path';
import { jsonOut } from '../../managers/core-manager.js';
import { normalizeId, matchesPrdDir, parentContainsEpic } from '../../lib/normalize.js';
import { getAllTasks } from '../../managers/artefacts-manager.js';
import { STATUS, normalizeStatus, isStatusDone, isStatusCancelled, statusSymbol } from '../../lib/lexicon.js';
import { buildDependencyGraph, blockersResolved } from '../../managers/graph-manager.js';
import { Task } from '../../lib/types/entities.js';
import type { Command } from 'commander';
import type { TaskListOptions } from '../../lib/types/task-options.js';

/**
 * Register task:list command
 */
export function registerListCommand(task: Command): void {
  const statusHelp = STATUS.task.join(', ');

  task.command('list [prd]')
    .description('List tasks (filter by PRD, epic, status, assignee, tag)')
    .option('-s, --status <status>', `Filter by status (${statusHelp})`)
    .option('-e, --epic <id>', 'Filter by epic (e.g., E035)')
    .option('-a, --assignee <name>', 'Filter by assignee')
    .option('-t, --tag <tag>', 'Filter by tag (repeatable, AND logic)', (v: string, arr: string[]) => arr.concat(v), [] as string[])
    .option('-r, --ready', 'Only show ready tasks (unblocked)')
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .option('--prd <id>', 'Filter by PRD (alias for positional arg)')
    .option('--path', 'Include file path (discouraged)')
    .option('--json', 'JSON output')
    .action((prdArg: string | undefined, options: TaskListOptions) => {
      const prd: string | undefined = prdArg || options.prd;
      const tasks: (Task & { file?: string; prd: string })[] = [];

      // Use artefacts.ts contract - single entry point
      for (const taskEntry of getAllTasks()) {
        // Extract prdDir from task file path
        const tasksDir = path.dirname(taskEntry.file);
        const prdDir = path.dirname(tasksDir);
        const prdName = path.basename(prdDir);

        // PRD filter
        if (prd && !matchesPrdDir(prdDir, prd)) continue;

        const data = taskEntry.data;
        if (!data) continue;

        // Status filter
        if (options.status) {
          const targetStatus = normalizeStatus(options.status, 'task');
          const taskStatus = normalizeStatus(data.status, 'task');
          if (targetStatus !== taskStatus) continue;
        }

        // Epic filter (format-agnostic: E1 matches E001 in parent)
        if (options.epic) {
          if (!parentContainsEpic(data.parent, options.epic)) continue;
        }

        // Assignee filter
        if (options.assignee) {
          const assignee = ((data.assignee) || '').toLowerCase();
          if (!assignee.includes(options.assignee.toLowerCase())) continue;
        }

        // Tag filter (AND logic - all specified tags must be present)
        if (options.tag && options.tag.length > 0) {
          const taskTags = (data.tags) || [];
          const allTagsMatch = options.tag.every((t: string) => taskTags.includes(t));
          if (!allTagsMatch) continue;
        }

        const taskResult: Task & { file?: string; prd: string } = {
          id: (data.id) || taskEntry.id,
          title: (data.title) || '',
          status: (data.status) || 'Unknown',
          parent: (data.parent) || '',
          assignee: (data.assignee) || 'unassigned',
          effort: (data.effort) || null,
          priority: (data.priority as "critical" | "low" | "normal" | "high") || 'normal',
          blocked_by: (data.blocked_by) || [],
          prd: prdName
        };
        if (options.path) taskResult.file = taskEntry.file;
        tasks.push(taskResult);
      }

      // Ready filter (unblocked AND not done/cancelled)
      let filtered = tasks;
      if (options.ready) {
        const { tasks: graphTasks } = buildDependencyGraph();
        filtered = tasks.filter(t => {
          // Exclude Done/Cancelled tasks
          if (isStatusDone(t.status) || isStatusCancelled(t.status)) return false;
          const graphTask = graphTasks.get(normalizeId(t.id));
          return graphTask && blockersResolved(graphTask, graphTasks);
        });
      }

      // Sort by ID
      filtered.sort((a, b) => {
        const numA = parseInt(a.id?.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.id?.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

      // Apply limit
      const limited = options.limit ? filtered.slice(0, options.limit) : filtered;

      if (options.json) {
        jsonOut(limited);
      } else {
        if (limited.length === 0) {
          console.log('No tasks found.');
        } else {
          limited.forEach(t => {
            const sym = statusSymbol(t.status);
            console.log(`${sym} ${t.id}: ${t.title} [${t.status}] @${t.assignee}`);
          });
          if (options.limit && filtered.length > options.limit) {
            console.log(`\n... and ${filtered.length - options.limit} more`);
          }
        }
      }
    });
}
