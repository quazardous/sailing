/**
 * Deps analysis commands (impact, ready, critical)
 */
import { jsonOut } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { isStatusDone, isStatusNotStarted, isStatusInProgress, isStatusCancelled } from '../../lib/lexicon.js';
import { buildDependencyGraph, blockersResolved, longestPath, countTotalUnblocked } from '../../managers/graph-manager.js';
import { buildEpicDependencyMap } from './helpers.js';
import type { Command } from 'commander';
import type { ImpactOptions, ReadyOptions, CriticalOptions } from './helpers.js';

/**
 * Register deps:impact, deps:ready, deps:critical commands
 */
export function registerAnalysisCommands(deps: Command): void {
  // deps:impact
  deps.command('impact <taskId>')
    .description('What gets unblocked when task completes')
    .option('--json', 'JSON output')
    .action((taskId: string, options: ImpactOptions) => {
      const id = normalizeId(taskId);
      const { tasks, blocks } = buildDependencyGraph();
      const task = tasks.get(id);

      if (!task) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      const dependents = blocks.get(id) || [];
      const directUnblocks: string[] = [];
      const stillBlocked: Array<{ id: string; waitingFor: string[] }> = [];

      for (const depId of dependents) {
        const depTask = tasks.get(depId);
        if (!depTask) continue;

        const otherBlockers = depTask.blockedBy.filter(b => b !== id);
        const othersDone = otherBlockers.every(b => {
          const blocker = tasks.get(b);
          return !blocker || isStatusDone(blocker.status) || isStatusCancelled(blocker.status);
        });

        if (othersDone) {
          directUnblocks.push(depId);
        } else {
          stillBlocked.push({ id: depId, waitingFor: otherBlockers.filter(b => {
            const blocker = tasks.get(b);
            return blocker && !isStatusDone(blocker.status) && !isStatusCancelled(blocker.status);
          })});
        }
      }

      const totalUnblocked = countTotalUnblocked(id, tasks, blocks);
      const { length: criticalPathLen, path: criticalPath } = longestPath(id, tasks, blocks);

      if (options.json) {
        jsonOut({
          task: { id, title: task.title, status: task.status },
          directUnblocks,
          stillBlocked,
          totalUnblocked,
          criticalPathLength: criticalPathLen,
          criticalPath
        });
      } else {
        console.log(`Impact of completing ${id}:\n`);

        if (directUnblocks.length > 0) {
          console.log(`Directly unblocks (${directUnblocks.length}):`);
          directUnblocks.forEach(d => {
            const t = tasks.get(d);
            console.log(`  → ${d}: ${t?.title || ''}`);
          });
          console.log('');
        }

        if (stillBlocked.length > 0) {
          console.log(`Still blocked (${stillBlocked.length}):`);
          stillBlocked.forEach(({ id: d, waitingFor }) => {
            const t = tasks.get(d);
            console.log(`  ✗ ${d}: ${t?.title || ''} (needs: ${waitingFor.join(', ')})`);
          });
          console.log('');
        }

        console.log(`Total tasks eventually unblocked: ${totalUnblocked}`);
        console.log(`Critical path length: ${criticalPathLen}`);
        if (criticalPath.length > 1) {
          console.log(`Critical path: ${criticalPath.join(' → ')}`);
        }
      }
    });

  // deps:ready
  deps.command('ready')
    .description('Ready tasks sorted by impact (best to work on first)')
    .option('--role <role>', 'Role context: agent blocked, skill/coordinator allowed')
    .option('--prd <id>', 'Filter by PRD')
    .option('--epic <id>', 'Filter by epic')
    .option('-t, --tag <tag>', 'Filter by tag (repeatable, AND logic)', (v, arr) => arr.concat(v), [])
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .option('--include-started', 'Include "In Progress" tasks (for resume)')
    .option('--json', 'JSON output')
    .action((options: ReadyOptions) => {
      if (options.role === 'agent') {
        console.error('ERROR: deps:ready cannot be called with --role agent');
        console.error('Agents execute assigned tasks. Skill/coordinator manage dependencies.');
        process.exit(1);
      }

      const { tasks, blocks } = buildDependencyGraph();
      const epics = buildEpicDependencyMap();
      const ready: Array<ReturnType<typeof buildDependencyGraph>['tasks'] extends Map<string, infer T> ? T & {impact: number; criticalPath: number} : never> = [];

      const epicBlockersResolved = (epicId: string | undefined): boolean => {
        if (!epicId) return true;
        const epic = epics.get(epicId);
        if (!epic) return true;

        for (const blockerId of epic.blockedBy) {
          const blocker = epics.get(blockerId);
          if (!blocker) continue;
          if (!isStatusDone(blocker.status)) {
            return false;
          }
        }
        return true;
      };

      const prdFilter = options.prd ? normalizeId(options.prd) : null;
      const epicFilter = options.epic ? normalizeId(options.epic) : null;

      for (const [id, task] of tasks) {
        if (prdFilter && !task.prd?.includes(prdFilter)) continue;
        if (epicFilter && task.epic !== epicFilter) continue;

        if (options.tag?.length > 0) {
          const taskTags = task.tags || [];
          const allTagsMatch = options.tag.every(t => taskTags.includes(t));
          if (!allTagsMatch) continue;
        }

        const statusOk = isStatusNotStarted(task.status) ||
                         (options.includeStarted && isStatusInProgress(task.status));
        const taskReady = statusOk && blockersResolved(task, tasks);
        const epicReady = epicBlockersResolved(task.epic);

        if (taskReady && epicReady) {
          const totalUnblocked = countTotalUnblocked(id, tasks, blocks);
          const { length: criticalPathLen } = longestPath(id, tasks, blocks);
          ready.push({
            ...task,
            impact: totalUnblocked,
            criticalPath: criticalPathLen
          });
        }
      }

      ready.sort((a, b) => {
        if (b.impact !== a.impact) return b.impact - a.impact;
        return b.criticalPath - a.criticalPath;
      });

      const limited = options.limit ? ready.slice(0, options.limit) : ready;

      if (options.json) {
        jsonOut(limited);
      } else {
        if (limited.length === 0) {
          console.log('No ready tasks.');
        } else {
          const header = options.includeStarted
            ? 'Ready tasks + In Progress (sorted by impact):'
            : 'Ready tasks (sorted by impact):';
          console.log(`${header}\n`);
          limited.forEach((t, i) => {
            const statusHint = isStatusInProgress(t.status) ? ' [In Progress]' : '';
            console.log(`${i + 1}. ${t.id}: ${t.title}${statusHint}`);
            console.log(`   Impact: ${t.impact} tasks | Critical path: ${t.criticalPath}`);
          });
        }
      }
    });

  // deps:critical
  deps.command('critical')
    .description('Find bottlenecks (tasks blocking the most work)')
    .option('--prd <id>', 'Filter by PRD')
    .option('-l, --limit <n>', 'Limit results', parseInt, 5)
    .action((options: CriticalOptions) => {
      const { tasks, blocks } = buildDependencyGraph();

      const scores: Array<{
        id: string;
        title: string;
        status: string;
        dependents: number;
        criticalPath: number;
        score: number;
      }> = [];

      for (const [id, task] of tasks) {
        if (isStatusDone(task.status) || isStatusCancelled(task.status)) continue;
        if (options.prd && !task.prd.includes(options.prd)) continue;

        const dependents = blocks.get(id) || [];
        const { length: criticalPathLen } = longestPath(id, tasks, blocks);

        scores.push({
          id,
          title: task.title,
          status: task.status,
          dependents: dependents.length,
          criticalPath: criticalPathLen,
          score: dependents.length * criticalPathLen
        });
      }

      scores.sort((a, b) => b.score - a.score);
      const top = scores.slice(0, options.limit);

      console.log('Critical path bottlenecks:\n');
      top.forEach((t, i) => {
        console.log(`${i + 1}. ${t.id}: ${t.title}`);
        console.log(`   Status: ${t.status} | Blocks: ${t.dependents} | Path: ${t.criticalPath}`);
      });
    });
}
