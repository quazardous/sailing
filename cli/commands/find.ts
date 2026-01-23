/**
 * Find command - search entities with filters and execute commands
 *
 * Examples:
 *   rudder find task --epic E001 --status "In Progress"
 *   rudder find task --blocked --exec "task:update {} --status Blocked"
 *   rudder find epic --prd PRD-001 --no-story --exec "epic:show {}"
 */
import { execSync } from 'child_process';
import path from 'path';
import type { Command } from 'commander';
import { findProjectRoot, jsonOut } from '../managers/core-manager.js';
import { normalizeId, parentContainsEpic, matchesPrd } from '../lib/normalize.js';
import { getAllEpics, getAllTasks, getAllPrds, getAllStories, getPrd } from '../managers/artefacts-manager.js';

// ============================================================================
// TYPES
// ============================================================================

interface FindFilters {
  prd?: string;
  epic?: string;
  status?: string;
  assignee?: string;
  tag?: string;
  blocked?: boolean;
  unblocked?: boolean;
  hasStory?: boolean;
  noStory?: boolean;
  type?: string;
  milestone?: string;
  targetVersion?: string;
}

interface PrdResult {
  id: string;
  title?: string;
  status?: string;
  file: string;
}

interface EpicResult {
  id: string;
  title?: string;
  status?: string;
  parent?: string;
  stories: string[];
  file: string;
}

interface TaskResult {
  id: string;
  title?: string;
  status?: string;
  parent?: string;
  assignee?: string;
  blocked_by: string[];
  stories: string[];
  file: string;
}

interface StoryResult {
  id: string;
  title?: string;
  type?: string;
  parent_story?: string;
  file: string;
}

interface ExecuteOptions {
  dryRun?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

interface ExecuteSuccess {
  id: string;
  output?: string;
  cmd?: string;
}

interface ExecuteError {
  id: string;
  error: string;
}

interface ExecuteResult {
  successes: ExecuteSuccess[];
  errors: ExecuteError[];
}

interface CommandOptions {
  status?: string;
  tag?: string;
  milestone?: string;
  prd?: string;
  epic?: string;
  assignee?: string;
  blocked?: boolean;
  unblocked?: boolean;
  hasStory?: boolean;
  story?: boolean;
  targetVersion?: string;
  type?: string;
  exec?: string;
  dryRun?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  json?: boolean;
  count?: boolean;
  ids?: boolean;
}

/**
 * Find PRDs matching filters
 * Uses artefacts.ts contract
 */
function findPrds(filters: FindFilters): PrdResult[] {
  const results: PrdResult[] = [];

  for (const prdEntry of getAllPrds()) {
    const data = prdEntry.data || {};

    if (!matchesFilters(data, filters)) continue;

    results.push({
      id: normalizeId(prdEntry.id),
      title: data.title,
      status: data.status,
      file: prdEntry.file
    });
  }

  return results;
}

/**
 * Find epics matching filters
 * Uses artefacts.ts contract
 */
function findEpics(filters: FindFilters): EpicResult[] {
  const results: EpicResult[] = [];

  for (const epicEntry of getAllEpics()) {
    // Filter by PRD if specified
    if (filters.prd) {
      if (!matchesPrd(epicEntry.prdId, filters.prd)) continue;
    }

    const data = epicEntry.data;
    if (!data) continue;

    if (!matchesFilters(data, filters)) continue;

    results.push({
      id: normalizeId(data.id),
      title: data.title,
      status: data.status,
      parent: data.parent,
      stories: data.stories || [],
      file: epicEntry.file
    });
  }

  return results;
}

/**
 * Find tasks matching filters
 * Uses artefacts.ts contract
 */
function findTasks(filters: FindFilters): TaskResult[] {
  const results: TaskResult[] = [];

  for (const taskEntry of getAllTasks()) {
    // Filter by PRD if specified
    if (filters.prd) {
      if (!matchesPrd(taskEntry.prdId, filters.prd)) continue;
    }

    const data = taskEntry.data;
    if (!data) continue;

    // Filter by epic (format-agnostic: E1 matches E001 in parent)
    if (filters.epic) {
      if (!parentContainsEpic(data.parent, filters.epic)) continue;
    }

    if (!matchesFilters(data, filters)) continue;

    results.push({
      id: normalizeId(data.id),
      title: data.title,
      status: data.status,
      parent: data.parent,
      assignee: data.assignee,
      blocked_by: data.blocked_by || [],
      stories: data.stories || [],
      file: taskEntry.file
    });
  }

  return results;
}

/**
 * Find stories matching filters
 * Uses artefacts.ts contract
 */
function findStories(filters: FindFilters): StoryResult[] {
  const results: StoryResult[] = [];

  // Get stories, optionally filtered by PRD
  let storyEntries = getAllStories();

  if (filters.prd) {
    const prd = getPrd(filters.prd);
    if (prd) {
      storyEntries = storyEntries.filter(s => s.prdId === prd.id);
    } else {
      // Fallback: filter by prdId
      storyEntries = storyEntries.filter(s => matchesPrd(s.prdId, filters.prd));
    }
  }

  for (const storyEntry of storyEntries) {
    const data = storyEntry.data || {};

    if (!matchesFilters(data, filters)) continue;

    results.push({
      id: normalizeId(data.id || storyEntry.id),
      title: data.title,
      type: data.type,
      parent_story: data.parent_story,
      file: storyEntry.file
    });
  }

  return results;
}

/**
 * Check if entity matches all filters
 */
function matchesFilters(data: Record<string, unknown>, filters: FindFilters): boolean {
  // Status filter
  if (filters.status) {
    const status = String(data.status || '').toLowerCase();
    const target = filters.status.toLowerCase();
    if (!status.includes(target)) return false;
  }

  // Tag filter
  if (filters.tag) {
    const tags = (data.tags || []) as string[];
    if (!tags.some(t => t.toLowerCase() === filters.tag.toLowerCase())) return false;
  }

  // Assignee filter
  if (filters.assignee) {
    const assignee = String(data.assignee || '').toLowerCase();
    if (!assignee.includes(filters.assignee.toLowerCase())) return false;
  }

  // Blocked filter (has blockers)
  if (filters.blocked) {
    const blockers = (data.blocked_by || []) as string[];
    if (blockers.length === 0) return false;
  }

  // Unblocked filter (no blockers)
  if (filters.unblocked) {
    const blockers = (data.blocked_by || []) as string[];
    if (blockers.length > 0) return false;
  }

  // Has story filter
  if (filters.hasStory) {
    const stories = (data.stories || []) as string[];
    if (stories.length === 0) return false;
  }

  // No story filter
  if (filters.noStory) {
    const stories = (data.stories || []) as string[];
    if (stories.length > 0) return false;
  }

  // Type filter (for stories)
  if (filters.type) {
    const type = String(data.type || '').toLowerCase();
    if (type !== filters.type.toLowerCase()) return false;
  }

  // Milestone filter
  if (filters.milestone) {
    const milestone = String(data.milestone || '');
    if (!milestone.includes(filters.milestone)) return false;
  }

  // Target version filter
  if (filters.targetVersion) {
    const versions = (data.target_versions || {}) as Record<string, string>;
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
function executeForEach(
  results: Array<{ id: string }>,
  cmdTemplate: string,
  options: ExecuteOptions
): ExecuteResult {
  const projectRoot = findProjectRoot();
  const errors: ExecuteError[] = [];
  const successes: ExecuteSuccess[] = [];

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
      const errorObj = e as { stderr?: Buffer | string; message?: string };
      const stderr = errorObj.stderr ? String(errorObj.stderr).trim() : '';
      const message = errorObj.message || '';
      const error = stderr || message;
      if (!options.quiet) {
        console.error(`${result.id}: FAILED - ${error}`);
      }
      errors.push({ id: result.id, error });
    }
  }

  return { successes, errors };
}

export function registerFindCommands(program: Command): Command {
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
    .action((options: CommandOptions) => {
      const filters: FindFilters = {
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
    .action((options: CommandOptions) => {
      const filters: FindFilters = {
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
    .action((options: CommandOptions) => {
      const filters: FindFilters = {
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
    .action((options: CommandOptions) => {
      const filters: FindFilters = {
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
