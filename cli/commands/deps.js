/**
 * Dependency commands for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, findFiles, loadFile, saveFile, jsonOut } from '../lib/core.js';
import { normalizeId, matchesId, extractTaskId, matchesPrdDir } from '../lib/normalize.js';
import { STATUS, normalizeStatus, isStatusDone, isStatusNotStarted, isStatusInProgress, isStatusCancelled, statusSymbol } from '../lib/lexicon.js';
import { buildDependencyGraph, detectCycles, findRoots, blockersResolved, longestPath, countTotalUnblocked, getAncestors, getDescendants } from '../lib/graph.js';
import { addDynamicHelp } from '../lib/help.js';

/**
 * Register deps commands
 */
export function registerDepsCommands(program) {
  const deps = program.command('deps').description('Dependency graph operations');

  // Dynamic help generated from registered commands
  addDynamicHelp(deps);

  // deps:tree
  deps.command('tree [taskId]')
    .description('Visualize dependency tree (ancestors/descendants)')
    .option('--ancestors', 'Show ancestors (blockers)')
    .option('--descendants', 'Show descendants (blocked by this)')
    .option('-d, --depth <n>', 'Max depth', parseInt)
    .option('--ready', 'Only show ready tasks')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      const { tasks, blocks } = buildDependencyGraph();
      const maxDepth = options.depth || Infinity;

      if (taskId) {
        const id = normalizeId(taskId);
        const task = tasks.get(id);
        if (!task) {
          console.error(`Task not found: ${id}`);
          process.exit(1);
        }

        if (options.ancestors) {
          const ancestors = getAncestors(id, tasks, maxDepth);
          if (options.json) {
            jsonOut([...ancestors].map(a => tasks.get(a)));
          } else {
            console.log(`Ancestors of ${id}:\n`);
            ancestors.forEach(a => {
              const t = tasks.get(a);
              if (t) console.log(`  ${statusSymbol(t.status)} ${a}: ${t.title}`);
            });
          }
        } else if (options.descendants) {
          const descendants = getDescendants(id, blocks, maxDepth);
          if (options.json) {
            jsonOut([...descendants].map(d => tasks.get(d)));
          } else {
            console.log(`Descendants of ${id}:\n`);
            descendants.forEach(d => {
              const t = tasks.get(d);
              if (t) console.log(`  ${statusSymbol(t.status)} ${d}: ${t.title}`);
            });
          }
        } else {
          // Show both
          const ancestors = getAncestors(id, tasks, maxDepth);
          const descendants = getDescendants(id, blocks, maxDepth);

          if (options.json) {
            jsonOut({
              task: tasks.get(id),
              ancestors: [...ancestors].map(a => tasks.get(a)),
              descendants: [...descendants].map(d => tasks.get(d))
            });
          } else {
            if (ancestors.size > 0) {
              console.log(`Blocked by (${ancestors.size}):`);
              ancestors.forEach(a => {
                const t = tasks.get(a);
                if (t) console.log(`  ${statusSymbol(t.status)} ${a}: ${t.title}`);
              });
              console.log('');
            }
            console.log(`→ ${statusSymbol(task.status)} ${id}: ${task.title}\n`);
            if (descendants.size > 0) {
              console.log(`Blocks (${descendants.size}):`);
              descendants.forEach(d => {
                const t = tasks.get(d);
                if (t) console.log(`  ${statusSymbol(t.status)} ${d}: ${t.title}`);
              });
            }
          }
        }
      } else {
        // Show roots and their trees
        const roots = findRoots(tasks);
        const output = [];

        function printTree(id, indent = '', depth = 0) {
          if (depth > maxDepth) return;
          const task = tasks.get(id);
          if (!task) return;

          if (options.ready && !blockersResolved(task, tasks)) return;

          output.push({
            id,
            title: task.title,
            status: task.status,
            depth,
            ready: blockersResolved(task, tasks)
          });

          if (!options.json) {
            const sym = statusSymbol(task.status);
            console.log(`${indent}${sym} ${id}: ${task.title}`);
          }

          const deps = blocks.get(id) || [];
          deps.forEach((depId, i) => {
            const isLast = i === deps.length - 1;
            printTree(depId, indent + (isLast ? '  ' : '│ '), depth + 1);
          });
        }

        roots.forEach(root => printTree(root));

        if (options.json) {
          jsonOut(output);
        }
      }
    });

  // deps:validate
  deps.command('validate')
    .description('Check deps (cycles, missing refs, status) → use --fix to auto-correct')
    .option('--prd <id>', 'Filter by PRD')
    .option('--fix', 'Auto-fix issues')
    .option('--json', 'JSON output')
    .action((options) => {
      const { tasks, blocks } = buildDependencyGraph();
      const errors = [];
      const warnings = [];
      const fixes = [];

      // Filter tasks by PRD if specified
      const prdFilter = options.prd ? normalizeId(options.prd) : null;

      for (const [id, task] of tasks) {
        // Skip tasks not matching PRD filter
        if (prdFilter && !task.prd?.includes(prdFilter)) continue;
        // 1. Missing refs
        for (const blockerId of task.blockedBy) {
          if (!tasks.has(blockerId)) {
            errors.push({
              type: 'missing_ref',
              task: id,
              blocker: blockerId,
              message: `${id}: blocked_by references non-existent task ${blockerId}`
            });
            if (options.fix) {
              fixes.push({ task: id, file: task.file, action: 'remove_missing', blockerId });
            }
          }
        }

        // 2. Self-references
        if (task.blockedBy.includes(id)) {
          errors.push({
            type: 'self_ref',
            task: id,
            message: `${id}: blocked_by contains self-reference`
          });
          if (options.fix) {
            fixes.push({ task: id, file: task.file, action: 'remove_self' });
          }
        }

        // 3. Duplicates
        const seen = new Set();
        const duplicates = [];
        for (const blockerId of task.blockedBy) {
          if (seen.has(blockerId)) duplicates.push(blockerId);
          seen.add(blockerId);
        }
        if (duplicates.length > 0) {
          warnings.push({
            type: 'duplicate',
            task: id,
            message: `${id}: blocked_by contains duplicates: ${duplicates.join(', ')}`
          });
          if (options.fix) {
            fixes.push({ task: id, file: task.file, action: 'remove_duplicates' });
          }
        }

        // 4. Format inconsistencies
        for (const raw of task.blockedByRaw) {
          const extracted = extractTaskId(raw);
          if (extracted && raw !== extracted) {
            warnings.push({
              type: 'format',
              task: id,
              message: `${id}: blocked_by "${raw}" should be "${extracted}"`
            });
            if (options.fix) {
              fixes.push({ task: id, file: task.file, action: 'normalize', raw, normalized: extracted });
            }
          }
        }

        // 5. Cancelled blockers
        for (const blockerId of task.blockedBy) {
          const blocker = tasks.get(blockerId);
          if (blocker && isStatusCancelled(blocker.status)) {
            warnings.push({
              type: 'cancelled_blocker',
              task: id,
              blocker: blockerId,
              message: `${id}: blocked by cancelled task ${blockerId}`
            });
            if (options.fix) {
              fixes.push({ task: id, file: task.file, action: 'remove_cancelled', blockerId });
            }
          }
        }

        // 6. Invalid status
        const canonical = normalizeStatus(task.status, 'task');
        if (!canonical) {
          errors.push({
            type: 'invalid_status',
            task: id,
            message: `${id}: Invalid status "${task.status}". Valid: ${STATUS.task.join(', ')}`
          });
        } else if (canonical !== task.status) {
          warnings.push({
            type: 'status_format',
            task: id,
            message: `${id}: Status "${task.status}" should be "${canonical}"`
          });
          if (options.fix) {
            fixes.push({ task: id, file: task.file, action: 'normalize_status', oldStatus: task.status, newStatus: canonical });
          }
        }
      }

      // 7. Cycles
      const cycles = detectCycles(tasks);
      for (const cycle of cycles) {
        errors.push({
          type: 'cycle',
          path: cycle,
          message: `Cycle detected: ${cycle.join(' → ')}`
        });
      }

      // 8. Orphan tasks
      for (const [id, task] of tasks) {
        if (prdFilter && !task.prd?.includes(prdFilter)) continue;
        const dependents = blocks.get(id) || [];
        if (dependents.length === 0 && task.blockedBy.length > 0 &&
            !isStatusDone(task.status) && !isStatusCancelled(task.status)) {
          warnings.push({
            type: 'orphan',
            task: id,
            message: `${id}: Leaf task with dependencies (orphan)`
          });
        }
      }

      // 9. ID mismatch
      for (const [id, task] of tasks) {
        if (prdFilter && !task.prd?.includes(prdFilter)) continue;
        if (!task.file) continue;
        const actualFilename = path.basename(task.file, '.md');
        const filenameId = actualFilename.match(/^(T\d+)/)?.[1];
        if (filenameId && filenameId !== id) {
          errors.push({
            type: 'id_mismatch',
            task: id,
            message: `${id}: Frontmatter ID doesn't match filename ID "${filenameId}"`
          });
          if (options.fix) {
            const newFilename = actualFilename.replace(/^T\d+/, id);
            fixes.push({ task: id, file: task.file, action: 'rename_file', oldName: actualFilename, newName: newFilename });
          }
        }
      }

      // 10. Epic/Task consistency
      const tasksByEpic = new Map();
      for (const [id, task] of tasks) {
        if (prdFilter && !task.prd?.includes(prdFilter)) continue;
        const epicMatch = task.parent?.match(/E(\d+)/i);
        if (epicMatch) {
          const epicId = normalizeId(`E${epicMatch[1]}`);
          if (!tasksByEpic.has(epicId)) tasksByEpic.set(epicId, []);
          tasksByEpic.get(epicId).push(task);
        }
      }

      for (const prdDir of findPrdDirs()) {
        // Skip PRDs not matching filter
        if (prdFilter && !matchesPrdDir(prdDir, options.prd)) continue;
        const epicDir = path.join(prdDir, 'epics');
        if (!fs.existsSync(epicDir)) continue;

        for (const ef of findFiles(epicDir, /^E\d+.*\.md$/)) {
          const epicFile = loadFile(ef);
          if (!epicFile?.data?.id) continue;

          const epicId = normalizeId(epicFile.data.id);
          const epicStatus = epicFile.data.status || 'Unknown';
          const epicTasks = tasksByEpic.get(epicId) || [];

          if (epicTasks.length === 0) continue;

          const allDone = epicTasks.every(t => isStatusDone(t.status) || isStatusCancelled(t.status));
          const anyInProgress = epicTasks.some(t => isStatusInProgress(t.status));

          if (isStatusNotStarted(epicStatus) && (anyInProgress || allDone)) {
            warnings.push({
              type: 'epic_status_mismatch',
              epic: epicId,
              message: `${epicId}: Status is "Not Started" but has tasks in progress or done`
            });
            if (options.fix) {
              const newStatus = allDone ? 'Done' : 'In Progress';
              fixes.push({ epic: epicId, file: ef, action: 'update_epic_status', newStatus });
            }
          }

          if (isStatusInProgress(epicStatus) && allDone) {
            warnings.push({
              type: 'epic_not_done',
              epic: epicId,
              message: `${epicId}: All ${epicTasks.length} tasks done but epic still "In Progress"`
            });
            if (options.fix) {
              fixes.push({ epic: epicId, file: ef, action: 'update_epic_status', newStatus: 'Done' });
            }
          }

          if (isStatusDone(epicStatus) && !allDone) {
            const notDone = epicTasks.filter(t => !isStatusDone(t.status) && !isStatusCancelled(t.status));
            errors.push({
              type: 'epic_done_prematurely',
              epic: epicId,
              message: `${epicId}: Marked "Done" but ${notDone.length} tasks incomplete`
            });
          }
        }
      }

      // Apply fixes
      let fixedCount = 0;
      if (options.fix && fixes.length > 0) {
        const fileUpdates = new Map();
        for (const f of fixes) {
          if (!fileUpdates.has(f.file)) {
            fileUpdates.set(f.file, { file: loadFile(f.file), fixes: [] });
          }
          fileUpdates.get(f.file).fixes.push(f);
        }

        for (const [filepath, { file, fixes: fileFixes }] of fileUpdates) {
          if (!file) continue;
          let updated = false;

          for (const fix of fileFixes) {
            if (!Array.isArray(file.data.blocked_by)) {
              file.data.blocked_by = [];
            }

            switch (fix.action) {
              case 'normalize': {
                const idx = file.data.blocked_by.indexOf(fix.raw);
                if (idx !== -1) {
                  file.data.blocked_by[idx] = fix.normalized;
                  updated = true;
                  fixedCount++;
                }
                break;
              }
              case 'remove_duplicates': {
                const unique = [...new Set(file.data.blocked_by)];
                if (unique.length !== file.data.blocked_by.length) {
                  file.data.blocked_by = unique;
                  updated = true;
                  fixedCount++;
                }
                break;
              }
              case 'remove_self': {
                const filtered = file.data.blocked_by.filter(b => extractTaskId(b) !== fix.task);
                if (filtered.length !== file.data.blocked_by.length) {
                  file.data.blocked_by = filtered;
                  updated = true;
                  fixedCount++;
                }
                break;
              }
              case 'remove_missing':
              case 'remove_cancelled': {
                const filtered = file.data.blocked_by.filter(b => extractTaskId(b) !== fix.blockerId);
                if (filtered.length !== file.data.blocked_by.length) {
                  file.data.blocked_by = filtered;
                  updated = true;
                  fixedCount++;
                }
                break;
              }
              case 'normalize_status': {
                if (file.data.status !== fix.newStatus) {
                  file.data.status = fix.newStatus;
                  updated = true;
                  fixedCount++;
                }
                break;
              }
              case 'update_epic_status': {
                if (file.data.status !== fix.newStatus) {
                  file.data.status = fix.newStatus;
                  updated = true;
                  fixedCount++;
                }
                break;
              }
            }
          }

          if (updated) {
            saveFile(filepath, file.data, file.body);
            if (!options.json) console.log(`Fixed: ${filepath}`);
          }
        }

        // Handle file renames
        for (const f of fixes) {
          if (f.action === 'rename_file') {
            const dir = path.dirname(f.file);
            const newPath = path.join(dir, `${f.newName}.md`);
            if (f.file !== newPath && fs.existsSync(f.file)) {
              fs.renameSync(f.file, newPath);
              if (!options.json) console.log(`Renamed: ${f.oldName}.md → ${f.newName}.md`);
              fixedCount++;
            }
          }
        }
      }

      if (options.json) {
        jsonOut({ errors, warnings, fixed: fixedCount });
        return;
      }

      console.log('=== Dependency Validation ===\n');

      if (errors.length === 0 && warnings.length === 0) {
        console.log('✓ All dependencies are valid\n');
        console.log(`Checked ${tasks.size} tasks`);
        return;
      }

      if (errors.length > 0) {
        console.log('ERRORS:');
        errors.forEach(e => console.log(`  ✗ ${e.message}`));
        console.log('');
      }

      if (warnings.length > 0) {
        console.log('WARNINGS:');
        warnings.forEach(w => console.log(`  ⚠ ${w.message}`));
        console.log('');
      }

      console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);

      if (!options.fix && fixes.length > 0) {
        console.log(`\nUse --fix to auto-correct ${fixes.length} issue(s)`);
      } else if (options.fix && fixedCount > 0) {
        console.log(`\nFixed ${fixedCount} issue(s)`);
      }
    });

  // deps:impact
  deps.command('impact <taskId>')
    .description('What gets unblocked when task completes')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      const id = normalizeId(taskId);
      const { tasks, blocks } = buildDependencyGraph();
      const task = tasks.get(id);

      if (!task) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      const dependents = blocks.get(id) || [];
      const directUnblocks = [];
      const stillBlocked = [];

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
    .option('--prd <id>', 'Filter by PRD')
    .option('--epic <id>', 'Filter by epic')
    .option('-l, --limit <n>', 'Limit results', parseInt)
    .option('--json', 'JSON output')
    .action((options) => {
      const { tasks, blocks } = buildDependencyGraph();
      const ready = [];

      // Normalize filters
      const prdFilter = options.prd ? normalizeId(options.prd) : null;
      const epicFilter = options.epic ? normalizeId(options.epic) : null;

      for (const [id, task] of tasks) {
        // Apply filters
        if (prdFilter && !task.prd?.includes(prdFilter)) continue;
        if (epicFilter && task.epic !== epicFilter) continue;

        if (isStatusNotStarted(task.status) && blockersResolved(task, tasks)) {
          const totalUnblocked = countTotalUnblocked(id, tasks, blocks);
          const { length: criticalPathLen } = longestPath(id, tasks, blocks);
          ready.push({
            ...task,
            impact: totalUnblocked,
            criticalPath: criticalPathLen
          });
        }
      }

      // Sort by impact, then critical path
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
          console.log('Ready tasks (sorted by impact):\n');
          limited.forEach((t, i) => {
            console.log(`${i + 1}. ${t.id}: ${t.title}`);
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
    .action((options) => {
      const { tasks, blocks } = buildDependencyGraph();

      // Calculate impact score for each incomplete task
      const scores = [];
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

  // deps:add
  deps.command('add <taskId>')
    .description('Add dependency (--blocks T001 or --blocked-by T002)')
    .option('--blocks <ids...>', 'This task blocks these tasks')
    .option('--blocked-by <ids...>', 'This task is blocked by these tasks')
    .action((taskId, options) => {
      const id = normalizeId(taskId);
      const { tasks } = buildDependencyGraph();

      if (!tasks.has(id)) {
        console.error(`Task not found: ${id}`);
        process.exit(1);
      }

      const task = tasks.get(id);

      if (options.blocks) {
        // Add this task as a blocker to others
        for (const targetId of options.blocks) {
          const tid = normalizeId(targetId);
          const target = tasks.get(tid);
          if (!target) {
            console.error(`Task not found: ${tid}`);
            continue;
          }

          const file = loadFile(target.file);
          if (!Array.isArray(file.data.blocked_by)) file.data.blocked_by = [];
          if (!file.data.blocked_by.includes(id)) {
            file.data.blocked_by.push(id);
            saveFile(target.file, file.data, file.body);
            console.log(`Added: ${tid} blocked by ${id}`);
          }
        }
      }

      if (options.blockedBy) {
        // Add blockers to this task
        const file = loadFile(task.file);
        if (!Array.isArray(file.data.blocked_by)) file.data.blocked_by = [];

        for (const blockerId of options.blockedBy) {
          const bid = normalizeId(blockerId);
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

      console.log('\nRun `rudder deps:validate` to check for cycles.');
    });

  // deps:show
  deps.command('show <id>')
    .description('Show dependencies (TNNN for task, ENNN for epic summary)')
    .option('--json', 'JSON output')
    .action((id, options) => {
      const { tasks, blocks } = buildDependencyGraph();
      const normalizedId = normalizeId(id);

      // Epic mode: show summary for all tasks in epic (ENNN)
      if (normalizedId.startsWith('E')) {
        const epicId = normalizedId;
        const epicTasks = [...tasks.values()].filter(t => {
          // Match by epic field or by parent containing the epic ID
          return t.epic === epicId || (t.parent && t.parent.includes(epicId));
        });

        if (epicTasks.length === 0) {
          console.error(`No tasks found for epic: ${epicId}`);
          process.exit(1);
        }

        const summary = epicTasks.map(t => {
          const dependents = blocks.get(t.id) || [];
          const externalBlockers = t.blockedBy.filter(b => {
            const blocker = tasks.get(b);
            return blocker && blocker.epic !== epicId;
          });
          const externalDependents = dependents.filter(d => {
            const dep = tasks.get(d);
            return dep && dep.epic !== epicId;
          });

          return {
            id: t.id,
            title: t.title,
            status: t.status,
            blockedBy: t.blockedBy,
            blocks: dependents,
            externalBlockers,
            externalDependents,
            ready: blockersResolved(t, tasks)
          };
        });

        if (options.json) {
          jsonOut(summary);
        } else {
          console.log(`Dependencies for ${epicId}:\n`);
          summary.forEach(t => {
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

          // Summary
          const readyCount = summary.filter(t => t.ready && !isStatusDone(t.status)).length;
          const doneCount = summary.filter(t => isStatusDone(t.status)).length;
          console.log(`\nSummary: ${doneCount} done, ${readyCount} ready, ${summary.length} total`);
        }
        return;
      }

      // Single task mode (TNNN)
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
