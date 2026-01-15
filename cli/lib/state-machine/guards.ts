/**
 * Guard Functions
 *
 * Conditions that must be satisfied for a transition to occur.
 * Each guard returns { ok: boolean, error?: string }
 */
import { execSync } from 'child_process';
import fs from 'fs';

/**
 * Guard result type
 */
interface GuardResult {
  ok: boolean;
  error?: string;
}

/**
 * Guard context type
 */
export interface GuardContext {
  projectRoot: string;
  worktreePath: string;
  branch: string;
  baseBranch?: string;
  conflictsWith?: string[];
}

/**
 * Guard function type
 */
type GuardFunction = (ctx: GuardContext) => GuardResult;

/**
 * Guard registry
 */
export const guards: Record<string, GuardFunction> = {
  /**
   * Check git is installed
   */
  hasGit: (_ctx) => {
    try {
      execSync('git --version', { stdio: 'pipe' });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Git not installed' };
    }
  },

  /**
   * Check we're in a git repository
   */
  hasGitRepo: (ctx) => {
    try {
      execSync('git rev-parse --git-dir', {
        cwd: ctx.projectRoot,
        stdio: 'pipe'
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Not a git repository' };
    }
  },

  /**
   * Check worktree doesn't already exist
   */
  noExistingWorktree: (ctx) => {
    if (fs.existsSync(ctx.worktreePath)) {
      return { ok: false, error: `Worktree already exists: ${ctx.worktreePath}` };
    }
    return { ok: true };
  },

  /**
   * Check branch name is available
   */
  branchAvailable: (ctx) => {
    try {
      execSync(`git rev-parse --verify ${ctx.branch}`, {
        cwd: ctx.projectRoot,
        stdio: 'pipe'
      });
      return { ok: false, error: `Branch already exists: ${ctx.branch}` };
    } catch {
      return { ok: true }; // Branch doesn't exist = available
    }
  },

  /**
   * Check worktree exists
   */
  worktreeExists: (ctx) => {
    if (!fs.existsSync(ctx.worktreePath)) {
      return { ok: false, error: `Worktree not found: ${ctx.worktreePath}` };
    }
    return { ok: true };
  },

  /**
   * Check worktree has no uncommitted changes
   */
  worktreeClean: (ctx) => {
    try {
      const status = execSync('git status --porcelain', {
        cwd: ctx.worktreePath,
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();
      if (status) {
        return { ok: false, error: 'Worktree has uncommitted changes' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  /**
   * Check worktree has commits to merge
   */
  hasCommits: (ctx) => {
    try {
      const count = execSync(
        `git rev-list --count HEAD ^${ctx.baseBranch || 'main'}`,
        { cwd: ctx.worktreePath, encoding: 'utf8', stdio: 'pipe' }
      ).trim();
      if (parseInt(count, 10) === 0) {
        return { ok: false, error: 'No commits to merge' };
      }
      return { ok: true };
    } catch {
      return { ok: true }; // Assume has commits if we can't check
    }
  },

  /**
   * Check all conflicts are resolved
   */
  conflictResolved: (ctx) => {
    try {
      const status = execSync('git status --porcelain', {
        cwd: ctx.projectRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      });
      // U = unmerged, AA = both added, DD = both deleted
      if (status.includes('UU') || status.includes('AA') || status.includes('DD') ||
          status.includes('AU') || status.includes('UA') ||
          status.includes('DU') || status.includes('UD')) {
        return { ok: false, error: 'Unresolved conflicts remain' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  /**
   * Check no parallel agent conflicts
   */
  noParallelConflicts: (ctx) => {
    if (ctx.conflictsWith?.length > 0) {
      return { ok: false, error: `Conflicts with: ${ctx.conflictsWith.join(', ')}` };
    }
    return { ok: true };
  }
};

/**
 * Run guards result type
 */
interface RunGuardsResult {
  ok: boolean;
  errors: string[];
}

/**
 * Run a list of guards
 * @param guardNames - Names of guards to run
 * @param ctx - Context object
 * @returns Result with ok status and any errors
 */
export function runGuards(guardNames: string[], ctx: GuardContext): RunGuardsResult {
  const errors: string[] = [];

  for (const name of guardNames) {
    const guard = guards[name];
    if (!guard) {
      errors.push(`Unknown guard: ${name}`);
      continue;
    }

    const result: GuardResult = guard(ctx);
    if (!result.ok) {
      errors.push(result.error || `Guard failed: ${name}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
