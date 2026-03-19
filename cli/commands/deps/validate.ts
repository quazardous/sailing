/**
 * Deps validate command
 */
import fs from 'fs';
import path from 'path';
import { loadFile, saveFile, jsonOut } from '../../managers/core-manager.js';
import { normalizeId, buildIdResolver } from '../../lib/normalize.js';
import { getAllEpics, matchesPrd } from '../../managers/artefacts-manager.js';
import { STATUS, normalizeStatus, isStatusDone, isStatusNotStarted, isStatusInProgress, isStatusCancelled } from '../../lib/lexicon.js';
import { buildDependencyGraph, detectCycles, type TaskNode } from '../../managers/graph-manager.js';
import { withModifies } from '../../lib/help.js';
import { buildEpicDependencyMap, detectEpicCycles } from './helpers.js';
import type { Command } from 'commander';
import type { TaskFrontmatter, ValidateOptions, ValidationError, Fix } from './helpers.js';

type TasksMap = Map<string, TaskNode>;
type BlocksMap = Map<string, string[]>;
type ValidationResult = { errors: ValidationError[]; warnings: ValidationError[]; fixes: Fix[] };

/** Filter tasks by prd */
function filterByPrd(tasks: TasksMap, prdFilter: string | null): [string, TaskNode][] {
  const entries: [string, TaskNode][] = [];
  for (const [id, task] of tasks) {
    if (prdFilter && !task.prd?.includes(prdFilter)) continue;
    entries.push([id, task]);
  }
  return entries;
}

/** Merge multiple validation results into accumulators */
function mergeResult(target: ValidationResult, source: ValidationResult): void {
  target.errors.push(...source.errors);
  target.warnings.push(...source.warnings);
  target.fixes.push(...source.fixes);
}

/** Check 1: missing refs for a single task */
function checkMissingRefs(id: string, task: TaskNode, tasks: TasksMap, options: ValidateOptions): ValidationResult {
  const errors: ValidationError[] = [];
  const fixes: Fix[] = [];
  for (const blockerId of task.blockedBy) {
    if (!tasks.has(blockerId)) {
      errors.push({ type: 'missing_ref', task: id, blocker: blockerId, message: `${id}: blocked_by references non-existent task ${blockerId}` });
      if (options.fix) fixes.push({ task: id, file: task.file, action: 'remove_missing', blockerId });
    }
  }
  return { errors, warnings: [], fixes };
}

/** Check 2: self-references for a single task */
function checkSelfRefs(id: string, task: TaskNode, options: ValidateOptions): ValidationResult {
  const errors: ValidationError[] = [];
  const fixes: Fix[] = [];
  if (task.blockedBy.includes(id)) {
    errors.push({ type: 'self_ref', task: id, message: `${id}: blocked_by contains self-reference` });
    if (options.fix) fixes.push({ task: id, file: task.file, action: 'remove_self' });
  }
  return { errors, warnings: [], fixes };
}

/** Check 3: duplicates for a single task */
function checkDuplicates(id: string, task: TaskNode, options: ValidateOptions): ValidationResult {
  const warnings: ValidationError[] = [];
  const fixes: Fix[] = [];
  const seen = new Set();
  const duplicates: string[] = [];
  for (const blockerId of task.blockedBy) {
    if (seen.has(blockerId)) duplicates.push(blockerId);
    seen.add(blockerId);
  }
  if (duplicates.length > 0) {
    warnings.push({ type: 'duplicate', task: id, message: `${id}: blocked_by contains duplicates: ${duplicates.join(', ')}` });
    if (options.fix) fixes.push({ task: id, file: task.file, action: 'remove_duplicates' });
  }
  return { errors: [], warnings, fixes };
}

/** Check 4: format inconsistencies for a single task */
function checkFormat(id: string, task: TaskNode, resolveTask: (raw: string) => string | null, options: ValidateOptions): ValidationResult {
  const warnings: ValidationError[] = [];
  const fixes: Fix[] = [];
  for (const raw of task.blockedByRaw) {
    const rawStr = String(raw as string | number);
    const canonical = resolveTask(rawStr);
    if (canonical && rawStr !== canonical) {
      warnings.push({ type: 'format', task: id, message: `${id}: blocked_by "${rawStr}" should be "${canonical}"` });
      if (options.fix) fixes.push({ task: id, file: task.file, action: 'normalize', raw: raw as string, normalized: canonical });
    }
  }
  return { errors: [], warnings, fixes };
}

/** Check 5: cancelled blockers for a single task */
function checkCancelledBlockers(id: string, task: TaskNode, tasks: TasksMap, options: ValidateOptions): ValidationResult {
  const warnings: ValidationError[] = [];
  const fixes: Fix[] = [];
  for (const blockerId of task.blockedBy) {
    const blocker = tasks.get(blockerId);
    if (blocker && isStatusCancelled(blocker.status)) {
      warnings.push({ type: 'cancelled_blocker', task: id, blocker: blockerId, message: `${id}: blocked by cancelled task ${blockerId}` });
      if (options.fix) fixes.push({ task: id, file: task.file, action: 'remove_cancelled', blockerId });
    }
  }
  return { errors: [], warnings, fixes };
}

/** Check 6: invalid status for a single task */
function checkStatus(id: string, task: TaskNode, options: ValidateOptions): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const fixes: Fix[] = [];
  const canonical = normalizeStatus(task.status, 'task');
  if (!canonical) {
    errors.push({ type: 'invalid_status', task: id, message: `${id}: Invalid status "${task.status}". Valid: ${STATUS.task.join(', ')}` });
  } else if (canonical !== task.status) {
    warnings.push({ type: 'status_format', task: id, message: `${id}: Status "${task.status}" should be "${canonical}"` });
    if (options.fix) fixes.push({ task: id, file: task.file, action: 'normalize_status', oldStatus: task.status, newStatus: canonical });
  }
  return { errors, warnings, fixes };
}

/**
 * Checks 1-6: missing refs, self-refs, duplicates, format, cancelled blockers, invalid status
 */
function validateTaskDependencies(
  tasks: TasksMap,
  resolveTask: (raw: string) => string | null,
  prdFilter: string | null,
  options: ValidateOptions
): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [], fixes: [] };

  for (const [id, task] of filterByPrd(tasks, prdFilter)) {
    mergeResult(result, checkMissingRefs(id, task, tasks, options));
    mergeResult(result, checkSelfRefs(id, task, options));
    mergeResult(result, checkDuplicates(id, task, options));
    mergeResult(result, checkFormat(id, task, resolveTask, options));
    mergeResult(result, checkCancelledBlockers(id, task, tasks, options));
    mergeResult(result, checkStatus(id, task, options));
  }

  return result;
}

/** Check a single epic for missing blocker refs */
function checkEpicMissingRefs(epicId: string, epic: { file: string; blockedBy: string[] }, epics: Map<string, unknown>, options: ValidateOptions): { errors: ValidationError[]; fixes: Fix[] } {
  const errors: ValidationError[] = [];
  const fixes: Fix[] = [];
  for (const blockerId of epic.blockedBy) {
    if (!epics.has(blockerId)) {
      errors.push({ type: 'epic_missing_ref', epic: epicId, blocker: blockerId, message: `${epicId}: blocked_by references non-existent epic ${blockerId}` });
      if (options.fix) fixes.push({ epic: epicId, file: epic.file, action: 'remove_epic_blocker', blockerId } as Fix);
    }
  }
  return { errors, fixes };
}

/** Check a single epic for self-refs */
function checkEpicSelfRef(epicId: string, epic: { file: string; blockedBy: string[] }, options: ValidateOptions): { errors: ValidationError[]; fixes: Fix[] } {
  const errors: ValidationError[] = [];
  const fixes: Fix[] = [];
  if (epic.blockedBy.includes(epicId)) {
    errors.push({ type: 'epic_self_ref', epic: epicId, message: `${epicId}: blocked_by contains self-reference` });
    if (options.fix) fixes.push({ epic: epicId, file: epic.file, action: 'remove_epic_self_ref' } as Fix);
  }
  return { errors, fixes };
}

/**
 * Epic missing refs, self-refs, cycles
 */
function validateEpicDependencies(
  _prdFilter: string | null,
  options: ValidateOptions
): { errors: ValidationError[]; fixes: Fix[] } {
  const errors: ValidationError[] = [];
  const fixes: Fix[] = [];

  const epics = buildEpicDependencyMap();
  for (const [epicId, epic] of epics) {
    const missingResult = checkEpicMissingRefs(epicId, epic, epics, options);
    errors.push(...missingResult.errors);
    fixes.push(...missingResult.fixes);

    const selfResult = checkEpicSelfRef(epicId, epic, options);
    errors.push(...selfResult.errors);
    fixes.push(...selfResult.fixes);
  }

  const epicCycles = detectEpicCycles(epics);
  for (const cycle of epicCycles) {
    errors.push({ type: 'epic_cycle', path: cycle, message: `Epic cycle detected: ${cycle.join(' → ')}` });
  }

  return { errors, fixes };
}

/** Check if a task is an orphan leaf */
function isOrphanLeaf(task: TaskNode, dependents: string[]): boolean {
  return dependents.length === 0 && task.blockedBy.length > 0 &&
    !isStatusDone(task.status) && !isStatusCancelled(task.status);
}

/** Check if a task has an epic parent */
function hasEpicParent(task: TaskNode): boolean {
  if (task.epic) return true;
  if (task.parent && /E\d+/i.exec(task.parent)) return true;
  return false;
}

/**
 * Orphan leaf tasks and tasks without epic parent
 */
function validateOrphanTasks(
  tasks: TasksMap,
  blocks: BlocksMap,
  prdFilter: string | null
): { errors: ValidationError[]; warnings: ValidationError[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const [id, task] of filterByPrd(tasks, prdFilter)) {
    if (isOrphanLeaf(task, blocks.get(id) || [])) {
      warnings.push({ type: 'orphan', task: id, message: `${id}: Leaf task with dependencies (orphan)` });
    }
    if (!hasEpicParent(task)) {
      errors.push({ type: 'missing_epic', task: id, message: `${id}: Task has no epic parent (parent: ${task.parent || 'none'})` });
    }
  }

  return { errors, warnings };
}

/** Check a single task for ID vs filename mismatch */
function checkSingleIdMismatch(id: string, task: TaskNode, options: ValidateOptions): { error: ValidationError | null; fix: Fix | null } {
  if (!task.file) return { error: null, fix: null };
  const actualFilename = path.basename(task.file, '.md');
  const filenameId = /^(T\d+)/.exec(actualFilename)?.[1];
  if (!filenameId || filenameId === id) return { error: null, fix: null };

  const error: ValidationError = { type: 'id_mismatch', task: id, message: `${id}: Frontmatter ID doesn't match filename ID "${filenameId}"` };
  let fix: Fix | null = null;
  if (options.fix) {
    const newFilename = actualFilename.replace(/^T\d+/, id);
    fix = { task: id, file: task.file, action: 'rename_file', oldName: actualFilename, newName: newFilename };
  }
  return { error, fix };
}

/**
 * Frontmatter ID vs filename mismatch
 */
function validateIdMismatches(
  tasks: TasksMap,
  prdFilter: string | null,
  options: ValidateOptions
): { errors: ValidationError[]; fixes: Fix[] } {
  const errors: ValidationError[] = [];
  const fixes: Fix[] = [];

  for (const [id, task] of filterByPrd(tasks, prdFilter)) {
    const { error, fix } = checkSingleIdMismatch(id, task, options);
    if (error) errors.push(error);
    if (fix) fixes.push(fix);
  }

  return { errors, fixes };
}

/** Build map of tasks grouped by their epic parent */
function buildTasksByEpicMap(tasks: TasksMap, prdFilter: string | null): Map<string, TaskNode[]> {
  const allEpics = getAllEpics();
  const resolveEpic = buildIdResolver(allEpics.map(e => e.id));
  const tasksByEpic = new Map<string, TaskNode[]>();

  for (const [, task] of filterByPrd(tasks, prdFilter)) {
    const epicMatch = task.parent ? /E(\d+)/i.exec(task.parent) : null;
    if (!epicMatch) continue;
    const epicId = resolveEpic(`E${epicMatch[1]}`) ?? `E${epicMatch[1]}`;
    if (!tasksByEpic.has(epicId)) tasksByEpic.set(epicId, []);
    (tasksByEpic.get(epicId)).push(task);
  }

  return tasksByEpic;
}

/** Check "Not Started" epic with active tasks */
function checkEpicNotStartedMismatch(
  epicId: string, epicStatus: string, epicFile: string, epicTasks: TaskNode[], options: ValidateOptions
): ValidationResult {
  const warnings: ValidationError[] = [];
  const fixes: Fix[] = [];
  const allDone = epicTasks.every(t => isStatusDone(t.status) || isStatusCancelled(t.status));
  const anyInProgress = epicTasks.some(t => isStatusInProgress(t.status));

  if (!isStatusNotStarted(epicStatus)) return { errors: [], warnings: [], fixes: [] };
  if (!anyInProgress && !allDone) return { errors: [], warnings: [], fixes: [] };

  warnings.push({ type: 'epic_status_mismatch', epic: epicId, message: `${epicId}: Status is "Not Started" but has tasks in progress or done` });
  if (options.fix) {
    const newStatus = allDone ? 'Done' : 'In Progress';
    fixes.push({ epic: epicId, file: epicFile, action: 'update_epic_status', newStatus });
  }
  return { errors: [], warnings, fixes };
}

/** Check "In Progress" epic with all tasks done */
function checkEpicNotDone(
  epicId: string, epicStatus: string, epicFile: string, epicTasks: TaskNode[], options: ValidateOptions
): ValidationResult {
  const warnings: ValidationError[] = [];
  const fixes: Fix[] = [];
  const allDone = epicTasks.every(t => isStatusDone(t.status) || isStatusCancelled(t.status));

  if (!isStatusInProgress(epicStatus) || !allDone) return { errors: [], warnings: [], fixes: [] };

  warnings.push({ type: 'epic_not_done', epic: epicId, message: `${epicId}: All ${epicTasks.length} tasks done but epic still "In Progress"` });
  if (options.fix) fixes.push({ epic: epicId, file: epicFile, action: 'update_epic_status', newStatus: 'Done' });
  return { errors: [], warnings, fixes };
}

/** Check "Done" epic with incomplete tasks */
function checkEpicDonePremature(
  epicId: string, epicStatus: string, epicTasks: TaskNode[]
): ValidationResult {
  if (!isStatusDone(epicStatus)) return { errors: [], warnings: [], fixes: [] };
  const notDone = epicTasks.filter(t => !isStatusDone(t.status) && !isStatusCancelled(t.status));
  if (notDone.length === 0) return { errors: [], warnings: [], fixes: [] };
  return {
    errors: [{ type: 'epic_done_prematurely', epic: epicId, message: `${epicId}: Marked "Done" but ${notDone.length} tasks incomplete` }],
    warnings: [],
    fixes: []
  };
}

/**
 * Epic status vs task status consistency
 */
function validateEpicTaskConsistency(
  tasks: TasksMap,
  prdFilter: string | null,
  options: ValidateOptions
): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [], fixes: [] };
  const tasksByEpic = buildTasksByEpicMap(tasks, prdFilter);

  for (const epicEntry of getAllEpics()) {
    if (prdFilter && !matchesPrd(epicEntry.prdId, options.prd)) continue;
    const epicId = epicEntry.id;
    if (!epicId) continue;

    const epicStatus = (epicEntry.data?.status) || 'Unknown';
    const epicTasks = tasksByEpic.get(epicId) || [];
    if (epicTasks.length === 0) continue;

    mergeResult(result, checkEpicNotStartedMismatch(epicId, epicStatus, epicEntry.file, epicTasks, options));
    mergeResult(result, checkEpicNotDone(epicId, epicStatus, epicEntry.file, epicTasks, options));
    mergeResult(result, checkEpicDonePremature(epicId, epicStatus, epicTasks));
  }

  return result;
}

/** Apply a normalize fix */
function applyNormalize(fileData: TaskFrontmatter, fix: Fix): boolean {
  if (!Array.isArray(fileData.blocked_by)) return false;
  const idx = fileData.blocked_by.indexOf(fix.raw);
  if (idx === -1) return false;
  fileData.blocked_by[idx] = fix.normalized;
  return true;
}

/** Apply a remove-duplicates fix */
function applyRemoveDuplicates(fileData: TaskFrontmatter): boolean {
  if (!Array.isArray(fileData.blocked_by)) return false;
  const unique = [...new Set(fileData.blocked_by)];
  if (unique.length === fileData.blocked_by.length) return false;
  fileData.blocked_by = unique;
  return true;
}

/** Apply a filter-based removal fix (self, missing, cancelled) */
function applyFilterRemoval(fileData: TaskFrontmatter, targetId: string | undefined, resolveTask: (raw: string) => string | null): boolean {
  if (!Array.isArray(fileData.blocked_by) || !targetId) return false;
  const filtered = fileData.blocked_by.filter(b => (resolveTask(b) ?? b) !== targetId);
  if (filtered.length === fileData.blocked_by.length) return false;
  fileData.blocked_by = filtered;
  return true;
}

/** Apply a status update fix */
function applyStatusUpdate(fileData: TaskFrontmatter, newStatus: string | undefined): boolean {
  if (!newStatus || fileData.status === newStatus) return false;
  fileData.status = newStatus;
  return true;
}

/** Apply a single fix action to a loaded file's data */
function applySingleFix(
  fix: Fix,
  fileData: TaskFrontmatter,
  resolveTask: (raw: string) => string | null
): boolean {
  if (!Array.isArray(fileData.blocked_by)) {
    fileData.blocked_by = [];
  }

  switch (fix.action) {
    case 'normalize': return applyNormalize(fileData, fix);
    case 'remove_duplicates': return applyRemoveDuplicates(fileData);
    case 'remove_self': return applyFilterRemoval(fileData, fix.task, resolveTask);
    case 'remove_missing':
    case 'remove_cancelled': return applyFilterRemoval(fileData, fix.blockerId, resolveTask);
    case 'normalize_status':
    case 'update_epic_status': return applyStatusUpdate(fileData, fix.newStatus);
    default: return false;
  }
}

/** Group fixes by file, loading each file once */
function groupFixesByFile(fixes: Fix[]): Map<string, {file: ReturnType<typeof loadFile<TaskFrontmatter>>; fixes: Fix[]}> {
  const fileUpdates = new Map<string, {file: ReturnType<typeof loadFile<TaskFrontmatter>>; fixes: Fix[]}>();
  for (const f of fixes) {
    if (!fileUpdates.has(f.file)) {
      fileUpdates.set(f.file, { file: loadFile<TaskFrontmatter>(f.file), fixes: [] });
    }
    (fileUpdates.get(f.file) as {file: ReturnType<typeof loadFile<TaskFrontmatter>>; fixes: Fix[]}).fixes.push(f);
  }
  return fileUpdates;
}

/** Apply all fixes for a single file, returning count of applied fixes */
function applyFixesForFile(
  fileFixes: Fix[],
  fileData: TaskFrontmatter,
  resolveTask: (raw: string) => string | null
): number {
  let count = 0;
  for (const fix of fileFixes) {
    if (applySingleFix(fix, fileData, resolveTask)) count++;
  }
  return count;
}

/** Apply file-content fixes (non-rename) grouped by file */
function applyFileContentFixes(
  fixes: Fix[],
  resolveTask: (raw: string) => string | null,
  options: ValidateOptions
): number {
  let fixedCount = 0;
  const fileUpdates = groupFixesByFile(fixes);

  for (const [filepath, { file, fixes: fileFixes }] of fileUpdates) {
    if (!file) continue;
    const count = applyFixesForFile(fileFixes, file.data, resolveTask);
    fixedCount += count;

    if (count > 0) {
      saveFile(filepath, file.data, file.body);
      if (!options.json) console.log(`Fixed: ${filepath}`);
    }
  }

  return fixedCount;
}

/** Apply file rename fixes */
function applyRenameFixes(fixes: Fix[], options: ValidateOptions): number {
  let fixedCount = 0;
  for (const f of fixes) {
    if (f.action !== 'rename_file') continue;
    const dir = path.dirname(f.file);
    const newPath = path.join(dir, `${f.newName}.md`);
    if (f.file === newPath) continue;
    if (!fs.existsSync(f.file)) continue;
    fs.renameSync(f.file, newPath);
    if (!options.json) console.log(`Renamed: ${f.oldName}.md → ${f.newName}.md`);
    fixedCount++;
  }
  return fixedCount;
}

/**
 * Apply fixes: file updates and renames
 */
function applyFixes(
  fixes: Fix[],
  resolveTask: (raw: string) => string | null,
  options: ValidateOptions
): number {
  return applyFileContentFixes(fixes, resolveTask, options) + applyRenameFixes(fixes, options);
}

/**
 * Print validation results as JSON or human-readable output
 */
function printValidationReport(
  errors: ValidationError[],
  warnings: ValidationError[],
  fixes: Fix[],
  fixedCount: number,
  taskCount: number,
  options: ValidateOptions
): void {
  if (options.json) {
    jsonOut({ errors, warnings, fixed: fixedCount });
    return;
  }

  console.log('=== Dependency Validation ===\n');

  if (errors.length === 0 && warnings.length === 0) {
    console.log('✓ All dependencies are valid\n');
    console.log(`Checked ${taskCount} tasks`);
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
}

/**
 * Register deps:validate command
 */
export function registerValidateCommand(deps: Command): void {
  withModifies(deps.command('validate'), ['task'])
    .description('Check deps (cycles, missing refs, status) → use --fix to auto-correct')
    .option('--prd <id>', 'Filter by PRD')
    .option('--fix', 'Auto-fix issues')
    .option('--json', 'JSON output')
    .action((options: ValidateOptions) => {
      const { tasks, blocks } = buildDependencyGraph();
      const resolveTask = buildIdResolver(tasks.keys());
      const prdFilter = options.prd ? normalizeId(options.prd) : null;

      const taskResult = validateTaskDependencies(tasks, resolveTask, prdFilter, options);
      const cycles = detectCycles(tasks);
      const cycleErrors: ValidationError[] = cycles.map(cycle => ({
        type: 'cycle',
        path: cycle,
        message: `Task cycle detected: ${cycle.join(' → ')}`
      }));
      const epicResult = validateEpicDependencies(prdFilter, options);
      const orphanResult = validateOrphanTasks(tasks, blocks, prdFilter);
      const idResult = validateIdMismatches(tasks, prdFilter, options);
      const consistencyResult = validateEpicTaskConsistency(tasks, prdFilter, options);

      const errors = [...taskResult.errors, ...cycleErrors, ...epicResult.errors, ...orphanResult.errors, ...idResult.errors, ...consistencyResult.errors];
      const warnings = [...taskResult.warnings, ...orphanResult.warnings, ...consistencyResult.warnings];
      const fixes = [...taskResult.fixes, ...epicResult.fixes, ...idResult.fixes, ...consistencyResult.fixes];

      let fixedCount = 0;
      if (options.fix && fixes.length > 0) {
        fixedCount = applyFixes(fixes, resolveTask, options);
      }

      printValidationReport(errors, warnings, fixes, fixedCount, tasks.size, options);
    });
}
