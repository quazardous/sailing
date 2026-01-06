/**
 * Find command - search entities with filters and execute commands
 *
 * Examples:
 *   rudder find task --epic E001 --status "In Progress"
 *   rudder find task --blocked --exec "task:update {} --status Blocked"
 *   rudder find epic --prd PRD-001 --no-story --exec "epic:show {}"
 */
import { Command } from 'commander';
import { execSync } from 'child_process';
import { findProjectRoot, jsonOut } from '../lib/core.js';
import { normalizeId, parentContainsEpic } from '../lib/normalize.js';

// Import list functions from other commands
import {
  findPrdDirs, findFiles, loadFile
} from '../lib/core.js';

/**
 * Find PRDs matching filters
 */
function findPrds(filters) {
  const prdDirs = findPrdDirs();
  const results = [];

  for (const dir of prdDirs) {
    const prdFile = findFiles(dir, 'prd.md')[0];
    if (!prdFile) continue;

    const file = loadFile(prdFile);
    const data = file.data || {};
    const id = data.id || dir.match(/PRD-\d+/i)?.[0];

    if (!matchesFilters(data, filters, 'prd')) continue;

    results.push({
      id: normalizeId(id),
      title: data.title,
      status: data.status,
      file: prdFile
    });
  }

  return results;
}

/**
 * Find epics matching filters
 */
function findEpics(filters) {
  const prdDirs = findPrdDirs();
  const results = [];

  // Filter by PRD if specified
  const targetPrds = filters.prd
    ? prdDirs.filter(d => d.toLowerCase().includes(normalizeId(filters.prd).toLowerCase()))
    : prdDirs;

  for (const prdDir of targetPrds) {
    const epicsDir = `${prdDir}/epics`;
    const epicFiles = findFiles(epicsDir, /^E\d+.*\.md$/);

    for (const epicFile of epicFiles) {
      const file = loadFile(epicFile);
      if (!file?.data) continue;
      const data = file.data;

      if (!matchesFilters(data, filters, 'epic')) continue;

      results.push({
        id: normalizeId(data.id),
        title: data.title,
        status: data.status,
        parent: data.parent,
        stories: data.stories || [],
        file: epicFile
      });
    }
  }

  return results;
}

/**
 * Find tasks matching filters
 */
function findTasks(filters) {
  const prdDirs = findPrdDirs();
  const results = [];

  // Filter by PRD if specified
  const targetPrds = filters.prd
    ? prdDirs.filter(d => d.toLowerCase().includes(normalizeId(filters.prd).toLowerCase()))
    : prdDirs;

  for (const prdDir of targetPrds) {
    const tasksDir = `${prdDir}/tasks`;
    const taskFiles = findFiles(tasksDir, /^T\d+.*\.md$/);

    for (const taskFile of taskFiles) {
      const file = loadFile(taskFile);
      if (!file?.data) continue;
      const data = file.data;

      // Filter by epic (format-agnostic: E1 matches E001 in parent)
      if (filters.epic) {
        if (!parentContainsEpic(data.parent, filters.epic)) continue;
      }

      if (!matchesFilters(data, filters, 'task')) continue;

      results.push({
        id: normalizeId(data.id),
        title: data.title,
        status: data.status,
        parent: data.parent,
        assignee: data.assignee,
        blocked_by: data.blocked_by || [],
        stories: data.stories || [],
        file: taskFile
      });
    }
  }

  return results;
}

/**
 * Find stories matching filters
 */
function findStories(filters) {
  const prdDirs = findPrdDirs();
  const results = [];

  // Filter by PRD if specified
  const targetPrds = filters.prd
    ? prdDirs.filter(d => d.toLowerCase().includes(normalizeId(filters.prd).toLowerCase()))
    : prdDirs;

  for (const prdDir of targetPrds) {
    const storiesDir = `${prdDir}/stories`;
    const storyFiles = findFiles(storiesDir, /^S\d+.*\.md$/);

    for (const storyFile of storyFiles) {
      const file = loadFile(storyFile);
      if (!file?.data) continue;
      const data = file.data;

      if (!matchesFilters(data, filters, 'story')) continue;

      results.push({
        id: normalizeId(data.id),
        title: data.title,
        type: data.type,
        parent_story: data.parent_story,
        file: storyFile
      });
    }
  }

  return results;
}

/**
 * Check if entity matches all filters
 */
function matchesFilters(data, filters, entityType) {
  // Status filter
  if (filters.status) {
    const status = (data.status || '').toLowerCase();
    const target = filters.status.toLowerCase();
    if (!status.includes(target)) return false;
  }

  // Tag filter
  if (filters.tag) {
    const tags = data.tags || [];
    if (!tags.some(t => t.toLowerCase() === filters.tag.toLowerCase())) return false;
  }

  // Assignee filter
  if (filters.assignee) {
    const assignee = (data.assignee || '').toLowerCase();
    if (!assignee.includes(filters.assignee.toLowerCase())) return false;
  }

  // Blocked filter (has blockers)
  if (filters.blocked) {
    const blockers = data.blocked_by || [];
    if (blockers.length === 0) return false;
  }

  // Unblocked filter (no blockers)
  if (filters.unblocked) {
    const blockers = data.blocked_by || [];
    if (blockers.length > 0) return false;
  }

  // Has story filter
  if (filters.hasStory) {
    const stories = data.stories || [];
    if (stories.length === 0) return false;
  }

  // No story filter
  if (filters.noStory) {
    const stories = data.stories || [];
    if (stories.length > 0) return false;
  }

  // Type filter (for stories)
  if (filters.type) {
    const type = (data.type || '').toLowerCase();
    if (type !== filters.type.toLowerCase()) return false;
  }

  // Milestone filter
  if (filters.milestone) {
    const milestone = data.milestone || '';
    if (!milestone.includes(filters.milestone)) return false;
  }

  // Target version filter
  if (filters.targetVersion) {
    const versions = data.target_versions || {};
    const [comp, ver] = filters.targetVersion.split(':');
    if (ver) {
      if (versions[comp] !== ver) return false;
    } else {
      if (!Object.keys(versions).includes(comp)) return false;
    }
  }

  return true;
}

/**
 * Execute command for each result
 */
function executeForEach(results, cmdTemplate, options) {
  const projectRoot = findProjectRoot();
  const errors = [];
  const successes = [];

  for (const result of results) {
    // Replace {} with entity ID
    const cmd = cmdTemplate.replace(/\{\}/g, result.id);
    const fullCmd = `bin/rudder ${cmd}`;

    if (options.dryRun) {
      console.log(`Would run: ${fullCmd}`);
      successes.push({ id: result.id, cmd: fullCmd });
      continue;
    }

    try {
      const output = execSync(fullCmd, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (!options.quiet) {
        console.log(`${result.id}: OK`);
        if (options.verbose && output.trim()) {
          console.log(output.trim().split('\n').map(l => `  ${l}`).join('\n'));
        }
      }
      successes.push({ id: result.id, output: output.trim() });
    } catch (e) {
      const error = e.stderr?.trim() || e.message;
      if (!options.quiet) {
        console.error(`${result.id}: FAILED - ${error}`);
      }
      errors.push({ id: result.id, error });
    }
  }

  return { successes, errors };
}

export function registerFindCommands(program) {
  const find = program.command('find')
    .description('Find entities with filters, optionally execute commands');

  // find prd
  find.command('prd')
    .description('Find PRDs')
    .option('-s, --status <status>', 'Filter by status')
    .option('-t, --tag <tag>', 'Filter by tag')
    .option('--milestone <id>', 'Filter by milestone')
    .option('--exec <cmd>', 'Execute rudder command for each result ({} = ID)')
    .option('--dry-run', 'Show what would be executed')
    .option('-q, --quiet', 'Suppress output except errors')
    .option('-v, --verbose', 'Show command output')
    .option('--json', 'JSON output')
    .option('--count', 'Only show count')
    .option('--ids', 'Only output IDs (one per line)')
    .action((options) => {
      const filters = {
        status: options.status,
        tag: options.tag,
        milestone: options.milestone
      };

      const results = findPrds(filters);

      if (options.exec) {
        const { successes, errors } = executeForEach(results, options.exec, options);
        if (options.json) {
          jsonOut({ found: results.length, successes: successes.length, errors: errors.length, results: successes, failures: errors });
        } else if (!options.quiet) {
          console.log(`\n${successes.length} succeeded, ${errors.length} failed`);
        }
        if (errors.length > 0) process.exit(1);
        return;
      }

      if (options.count) {
        console.log(results.length);
        return;
      }

      if (options.ids) {
        results.forEach(r => console.log(r.id));
        return;
      }

      if (options.json) {
        jsonOut(results);
        return;
      }

      if (results.length === 0) {
        console.log('No PRDs found');
        return;
      }

      results.forEach(r => {
        console.log(`${r.id}: ${r.title} [${r.status || 'No Status'}]`);
      });
    });

  // find epic
  find.command('epic')
    .description('Find epics')
    .option('-p, --prd <id>', 'Filter by PRD')
    .option('-s, --status <status>', 'Filter by status')
    .option('-t, --tag <tag>', 'Filter by tag')
    .option('--has-story', 'Only epics with stories')
    .option('--no-story', 'Only epics without stories')
    .option('--milestone <id>', 'Filter by milestone')
    .option('--target-version <comp:ver>', 'Filter by target version')
    .option('--exec <cmd>', 'Execute rudder command for each result ({} = ID)')
    .option('--dry-run', 'Show what would be executed')
    .option('-q, --quiet', 'Suppress output except errors')
    .option('-v, --verbose', 'Show command output')
    .option('--json', 'JSON output')
    .option('--count', 'Only show count')
    .option('--ids', 'Only output IDs (one per line)')
    .action((options) => {
      const filters = {
        prd: options.prd,
        status: options.status,
        tag: options.tag,
        hasStory: options.hasStory,
        noStory: options.story === false,  // --no-story sets story to false
        milestone: options.milestone,
        targetVersion: options.targetVersion
      };

      const results = findEpics(filters);

      if (options.exec) {
        const { successes, errors } = executeForEach(results, options.exec, options);
        if (options.json) {
          jsonOut({ found: results.length, successes: successes.length, errors: errors.length, results: successes, failures: errors });
        } else if (!options.quiet) {
          console.log(`\n${successes.length} succeeded, ${errors.length} failed`);
        }
        if (errors.length > 0) process.exit(1);
        return;
      }

      if (options.count) {
        console.log(results.length);
        return;
      }

      if (options.ids) {
        results.forEach(r => console.log(r.id));
        return;
      }

      if (options.json) {
        jsonOut(results);
        return;
      }

      if (results.length === 0) {
        console.log('No epics found');
        return;
      }

      results.forEach(r => {
        const stories = r.stories.length > 0 ? ` (${r.stories.length} stories)` : '';
        console.log(`${r.id}: ${r.title} [${r.status || 'No Status'}]${stories}`);
      });
    });

  // find task
  find.command('task')
    .description('Find tasks')
    .option('-p, --prd <id>', 'Filter by PRD')
    .option('-e, --epic <id>', 'Filter by epic')
    .option('-s, --status <status>', 'Filter by status')
    .option('-a, --assignee <name>', 'Filter by assignee')
    .option('-t, --tag <tag>', 'Filter by tag')
    .option('--blocked', 'Only blocked tasks')
    .option('--unblocked', 'Only unblocked tasks')
    .option('--has-story', 'Only tasks with stories')
    .option('--no-story', 'Only tasks without stories')
    .option('--target-version <comp:ver>', 'Filter by target version')
    .option('--exec <cmd>', 'Execute rudder command for each result ({} = ID)')
    .option('--dry-run', 'Show what would be executed')
    .option('-q, --quiet', 'Suppress output except errors')
    .option('-v, --verbose', 'Show command output')
    .option('--json', 'JSON output')
    .option('--count', 'Only show count')
    .option('--ids', 'Only output IDs (one per line)')
    .action((options) => {
      const filters = {
        prd: options.prd,
        epic: options.epic,
        status: options.status,
        assignee: options.assignee,
        tag: options.tag,
        blocked: options.blocked,
        unblocked: options.unblocked,
        hasStory: options.hasStory,
        noStory: options.story === false,
        targetVersion: options.targetVersion
      };

      const results = findTasks(filters);

      if (options.exec) {
        const { successes, errors } = executeForEach(results, options.exec, options);
        if (options.json) {
          jsonOut({ found: results.length, successes: successes.length, errors: errors.length, results: successes, failures: errors });
        } else if (!options.quiet) {
          console.log(`\n${successes.length} succeeded, ${errors.length} failed`);
        }
        if (errors.length > 0) process.exit(1);
        return;
      }

      if (options.count) {
        console.log(results.length);
        return;
      }

      if (options.ids) {
        results.forEach(r => console.log(r.id));
        return;
      }

      if (options.json) {
        jsonOut(results);
        return;
      }

      if (results.length === 0) {
        console.log('No tasks found');
        return;
      }

      results.forEach(r => {
        const blocked = r.blocked_by.length > 0 ? ' [BLOCKED]' : '';
        const assignee = r.assignee ? ` @${r.assignee}` : '';
        console.log(`${r.id}: ${r.title} [${r.status || 'No Status'}]${blocked}${assignee}`);
      });
    });

  // find story
  find.command('story')
    .description('Find stories')
    .option('-p, --prd <id>', 'Filter by PRD')
    .option('--type <type>', 'Filter by type (user, technical, api)')
    .option('--exec <cmd>', 'Execute rudder command for each result ({} = ID)')
    .option('--dry-run', 'Show what would be executed')
    .option('-q, --quiet', 'Suppress output except errors')
    .option('-v, --verbose', 'Show command output')
    .option('--json', 'JSON output')
    .option('--count', 'Only show count')
    .option('--ids', 'Only output IDs (one per line)')
    .action((options) => {
      const filters = {
        prd: options.prd,
        type: options.type
      };

      const results = findStories(filters);

      if (options.exec) {
        const { successes, errors } = executeForEach(results, options.exec, options);
        if (options.json) {
          jsonOut({ found: results.length, successes: successes.length, errors: errors.length, results: successes, failures: errors });
        } else if (!options.quiet) {
          console.log(`\n${successes.length} succeeded, ${errors.length} failed`);
        }
        if (errors.length > 0) process.exit(1);
        return;
      }

      if (options.count) {
        console.log(results.length);
        return;
      }

      if (options.ids) {
        results.forEach(r => console.log(r.id));
        return;
      }

      if (options.json) {
        jsonOut(results);
        return;
      }

      if (results.length === 0) {
        console.log('No stories found');
        return;
      }

      results.forEach(r => {
        const type = r.type ? ` [${r.type}]` : '';
        console.log(`${r.id}: ${r.title}${type}`);
      });
    });

  return find;
}
