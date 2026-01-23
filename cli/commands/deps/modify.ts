/**
 * Deps modification commands (add, show)
 */
import { loadFile, saveFile, jsonOut } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { matchesEpic } from '../../managers/artefacts-manager.js';
import { isStatusDone, statusSymbol } from '../../lib/lexicon.js';
import { buildDependencyGraph, blockersResolved } from '../../managers/graph-manager.js';
import { withModifies } from '../../lib/help.js';
import { isEpicId, buildEpicDependencyMap } from './helpers.js';
import type { Command } from 'commander';
import type { TaskFrontmatter, AddOptions, ShowOptions } from './helpers.js';

/**
 * Register deps:add and deps:show commands
 */
export function registerModifyCommands(deps: Command): void {
  // deps:add
  withModifies(deps.command('add <id>'), ['task'])
    .description('Add dependency (--blocks or --blocked-by, supports TNNN and ENNN)')
    .option('--blocks <ids...>', 'This entity blocks these entities')
    .option('--blocked-by <ids...>', 'This entity is blocked by these entities')
    .action((entityId: string, options: AddOptions) => {
      const id = normalizeId(entityId);
      const isEpic = isEpicId(id);

      if (isEpic) {
        const epics = buildEpicDependencyMap();

        if (!epics.has(id)) {
          console.error(`Epic not found: ${id}`);
          process.exit(1);
        }

        if (options.blocks) {
          for (const targetId of options.blocks) {
            const tid = normalizeId(targetId);
            if (!isEpicId(tid)) {
              console.error(`Epic can only block epics, not tasks: ${tid}`);
              continue;
            }
            const target = epics.get(tid);
            if (!target) {
              console.error(`Epic not found: ${tid}`);
              continue;
            }

            const file = loadFile<TaskFrontmatter>(target.file);
            if (!file) continue;
            if (!Array.isArray(file.data.blocked_by)) file.data.blocked_by = [];
            if (!file.data.blocked_by.includes(id)) {
              file.data.blocked_by.push(id);
              saveFile(target.file, file.data, file.body);
              console.log(`Added: ${tid} blocked by ${id}`);
            }
          }
        }

        if (options.blockedBy) {
          const epic = epics.get(id);
          if (!epic) return;
          const file = loadFile<TaskFrontmatter>(epic.file);
          if (!file) return;
          if (!Array.isArray(file.data.blocked_by)) file.data.blocked_by = [];

          for (const blockerId of options.blockedBy) {
            const bid = normalizeId(blockerId);
            if (!isEpicId(bid)) {
              console.error(`Epic can only be blocked by epics, not tasks: ${bid}`);
              continue;
            }
            if (!epics.has(bid)) {
              console.error(`Epic not found: ${bid}`);
              continue;
            }

            if (!file.data.blocked_by.includes(bid)) {
              file.data.blocked_by.push(bid);
              console.log(`Added: ${id} blocked by ${bid}`);
            }
          }

          saveFile(epic.file, file.data, file.body);
        }
      } else {
        const { tasks } = buildDependencyGraph();

        if (!tasks.has(id)) {
          console.error(`Task not found: ${id}`);
          process.exit(1);
        }

        const task = tasks.get(id);
        if (!task) return;

        if (options.blocks) {
          for (const targetId of options.blocks) {
            const tid = normalizeId(targetId);
            if (isEpicId(tid)) {
              console.error(`Task can only block tasks, not epics: ${tid}`);
              continue;
            }
            const target = tasks.get(tid);
            if (!target) {
              console.error(`Task not found: ${tid}`);
              continue;
            }

            const file = loadFile<TaskFrontmatter>(target.file);
            if (!file) continue;
            if (!Array.isArray(file.data.blocked_by)) file.data.blocked_by = [];
            if (!file.data.blocked_by.includes(id)) {
              file.data.blocked_by.push(id);
              saveFile(target.file, file.data, file.body);
              console.log(`Added: ${tid} blocked by ${id}`);
            }
          }
        }

        if (options.blockedBy) {
          const file = loadFile<TaskFrontmatter>(task.file);
          if (!file) return;
          if (!Array.isArray(file.data.blocked_by)) file.data.blocked_by = [];

          for (const blockerId of options.blockedBy) {
            const bid = normalizeId(blockerId);
            if (isEpicId(bid)) {
              console.error(`Task can only be blocked by tasks, not epics: ${bid}`);
              continue;
            }
            if (!tasks.has(bid)) {
              console.error(`Task not found: ${bid}`);
              continue;
            }
            if (!file.data.blocked_by.includes(bid)) {
              file.data.blocked_by.push(bid);
              console.log(`Added: ${id} blocked by ${bid}`);
            }
          }

          saveFile(task.file, file.data, file.body);
        }
      }

      console.log('\nRun `rudder deps:validate` to check for cycles.');
    });

  // deps:show
  deps.command('show <id>')
    .description('Show dependencies (TNNN for task, ENNN for epic with blockers)')
    .option('--role <role>', 'Role context: agent blocked, skill/coordinator allowed')
    .option('--json', 'JSON output')
    .action(async (id: string, options: ShowOptions) => {
      if (options.role === 'agent') {
        console.error('ERROR: deps:show cannot be called with --role agent');
        console.error('Agents execute assigned tasks. Use task:show-memory for context.');
        process.exit(1);
      }

      const { tasks, blocks } = buildDependencyGraph();
      const epics = buildEpicDependencyMap();
      const normalizedId = normalizeId(id);

      // Epic mode
      if (normalizedId.startsWith('E')) {
        const epicId = normalizedId;
        const epic = epics.get(epicId);

        if (!epic) {
          console.error(`Epic not found: ${epicId}`);
          process.exit(1);
        }

        const epicTasks = [...tasks.values()].filter(t => {
          return matchesEpic(t.epic, epicId);
        });

        const epicBlockers = epic.blockedBy.map(bid => {
          const b = epics.get(bid);
          return b ? { id: bid, status: b.status, done: isStatusDone(b.status) } : null;
        }).filter((b): b is { id: string; status: string; done: boolean } => b !== null);

        const epicBlocks = [...epics.values()]
          .filter(e => e.blockedBy.includes(epicId))
          .map(e => ({ id: e.id, status: e.status }));

        const epicReady = epicBlockers.every(b => b.done);

        const taskSummary = epicTasks.map(t => {
          const dependents = blocks.get(t.id) || [];
          return {
            id: t.id,
            title: t.title,
            status: t.status,
            blockedBy: t.blockedBy,
            blocks: dependents,
            ready: blockersResolved(t, tasks) && epicReady
          };
        });

        if (options.json) {
          jsonOut({
            epic: {
              id: epicId,
              status: epic.status,
              blockedBy: epicBlockers,
              blocks: epicBlocks,
              ready: epicReady
            },
            tasks: taskSummary
          });
        } else {
          console.log(`Epic ${epicId} (${epic.status}):\n`);

          if (epicBlockers.length > 0) {
            const blockerStatus = epicBlockers.map(b => `${b.id}${b.done ? ' ✓' : ''}`).join(', ');
            console.log(`  ← blocked by epics: ${blockerStatus}`);
          }
          if (epicBlocks.length > 0) {
            console.log(`  → blocks epics: ${epicBlocks.map(e => e.id).join(', ')}`);
          }
          if (!epicReady) {
            console.log(`  ⚠ Epic blocked - waiting for: ${epicBlockers.filter(b => !b.done).map(b => b.id).join(', ')}`);
          }

          if (epicTasks.length > 0) {
            console.log(`\nTasks (${epicTasks.length}):\n`);
            taskSummary.forEach(t => {
              const sym = statusSymbol(t.status);
              const ready = t.ready && !isStatusDone(t.status) ? ' ✓' : '';
              console.log(`${sym} ${t.id}: ${t.title}${ready}`);
              if (t.blockedBy.length > 0) {
                console.log(`   ← blocked by: ${t.blockedBy.join(', ')}`);
              }
              if (t.blocks.length > 0) {
                console.log(`   → blocks: ${t.blocks.join(', ')}`);
              }
            });
          }

          const readyCount = taskSummary.filter(t => t.ready && !isStatusDone(t.status)).length;
          const doneCount = taskSummary.filter(t => isStatusDone(t.status)).length;
          console.log(`\nSummary: ${doneCount} done, ${readyCount} ready, ${epicTasks.length} total`);
        }
        return;
      }

      // Single task mode
      const task = tasks.get(normalizedId);

      if (!task) {
        console.error(`Task not found: ${normalizedId}`);
        process.exit(1);
      }

      console.log(`${normalizedId}: ${task.title}\n`);
      console.log(`Status: ${task.status}`);

      if (task.blockedBy.length > 0) {
        console.log(`\nBlocked by:`);
        task.blockedBy.forEach(b => {
          const blocker = tasks.get(b);
          const sym = blocker ? statusSymbol(blocker.status) : '?';
          console.log(`  ${sym} ${b}: ${blocker?.title || '(not found)'}`);
        });
      } else {
        console.log('\nNo blockers (root task)');
      }

      const dependents = blocks.get(normalizedId) || [];
      if (dependents.length > 0) {
        console.log(`\nBlocks:`);
        dependents.forEach(d => {
          const dep = tasks.get(d);
          const sym = dep ? statusSymbol(dep.status) : '?';
          console.log(`  ${sym} ${d}: ${dep?.title || '(not found)'}`);
        });
      } else {
        console.log('\nNo dependents (leaf task)');
      }

      const isReady = blockersResolved(task, tasks);
      if (isReady && !isStatusDone(task.status)) {
        console.log('\n✓ Ready to start');
      }
    });
}
