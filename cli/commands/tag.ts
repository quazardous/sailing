/**
 * Tag commands for rudder CLI
 */
import path from 'path';
import { findPrdDirs, findFiles, loadFile, jsonOut } from '../lib/core.js';
import { addDynamicHelp } from '../lib/help.js';

/**
 * Register tag commands
 */
export function registerTagCommands(program) {
  const tag = program.command('tag').description('Tag operations');

  // Dynamic help generated from registered commands
  addDynamicHelp(tag, { entityType: 'tag' });

  // tag:list
  tag.command('list')
    .description('List all tags with counts by artefact type')
    .option('--json', 'JSON output')
    .action((options) => {
      // Map<tag, {prd: N, epic: N, task: N}>
      const tagCounts = new Map();

      const addTags = (tags, type) => {
        for (const t of (tags || [])) {
          if (!tagCounts.has(t)) {
            tagCounts.set(t, { prd: 0, epic: 0, task: 0, total: 0 });
          }
          const counts = tagCounts.get(t);
          counts[type]++;
          counts.total++;
        }
      };

      // Scan all PRDs
      for (const prdDir of findPrdDirs()) {
        const prdFile = path.join(prdDir, 'prd.md');
        const prd = loadFile(prdFile);
        if (prd?.data?.tags) {
          addTags(prd.data.tags, 'prd');
        }

        // Scan epics
        const epicsDir = path.join(prdDir, 'epics');
        for (const epicFile of findFiles(epicsDir, /^E\d+.*\.md$/)) {
          const epic = loadFile(epicFile);
          if (epic?.data?.tags) {
            addTags(epic.data.tags, 'epic');
          }
        }

        // Scan tasks
        const tasksDir = path.join(prdDir, 'tasks');
        for (const taskFile of findFiles(tasksDir, /^T\d+.*\.md$/)) {
          const task = loadFile(taskFile);
          if (task?.data?.tags) {
            addTags(task.data.tags, 'task');
          }
        }
      }

      // Sort by total count descending
      const sorted = [...tagCounts.entries()].sort((a, b) => b[1].total - a[1].total);

      if (options.json) {
        const result = sorted.map(([tag, counts]) => ({ tag, ...counts }));
        jsonOut(result);
      } else {
        if (sorted.length === 0) {
          console.log('No tags found.');
        } else {
          console.log('Tags:\n');
          for (const [tag, counts] of sorted) {
            const parts = [];
            if (counts.prd > 0) parts.push(`${counts.prd} PRD`);
            if (counts.epic > 0) parts.push(`${counts.epic} epic`);
            if (counts.task > 0) parts.push(`${counts.task} task`);
            console.log(`  ${tag}: ${counts.total} (${parts.join(', ')})`);
          }
        }
      }
    });
}
