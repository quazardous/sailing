/**
 * Guard evaluation engine
 *
 * Evaluates guards defined in guards.yaml using LiquidJS templates.
 *
 * Usage:
 *   import { checkGuards, formatGuardOutput } from './guards.js';
 *
 *   const result = checkGuards('agent:spawn', {
 *     taskId: 'T001',
 *     gitClean: false,
 *     // ...
 *   });
 *
 *   if (!result.ok) {
 *     console.error(result.output);
 *     process.exit(result.exitCode);
 *   }
 */

import fs from 'fs';
import path from 'path';
import { Liquid } from 'liquidjs';
import yaml from 'js-yaml';
import type {
  GuardsConfig,
  CommandGuard,
  GuardCheck,
  GuardPost,
  GuardContext,
  GuardResult,
  CheckResult,
  PostResult
} from './types/guards.js';

// Singleton Liquid engine
let liquidEngine: Liquid | null = null;

/**
 * Get or create Liquid engine instance
 */
function getLiquid(): Liquid {
  if (!liquidEngine) {
    liquidEngine = new Liquid({
      strictVariables: false,  // Allow undefined variables
      strictFilters: false,
      trimTagLeft: true,
      trimTagRight: true
    });
  }
  return liquidEngine;
}

/**
 * GuardChecker - Pure guard evaluation with injected startDir
 *
 * Usage:
 *   const checker = new GuardChecker(process.cwd());
 *   const result = await checker.check('agent:spawn', context);
 */
export class GuardChecker {
  private guardsCache: GuardsConfig | null = null;

  constructor(private startDir: string) {}

  /**
   * Find prompting directory (search up from startDir)
   */
  private findPromptingDir(): string | null {
    let dir = this.startDir;
    while (dir !== '/') {
      const promptingDir = path.join(dir, 'prompting');
      if (fs.existsSync(promptingDir)) {
        return promptingDir;
      }
      // Also check .sailing for installed projects
      const sailingPrompting = path.join(dir, '.sailing', 'prompting');
      if (fs.existsSync(sailingPrompting)) {
        return sailingPrompting;
      }
      dir = path.dirname(dir);
    }
    return null;
  }

  /**
   * Load guards.yaml configuration
   */
  loadConfig(): GuardsConfig | null {
    if (this.guardsCache) return this.guardsCache;

    const promptingDir = this.findPromptingDir();
    if (!promptingDir) return null;

    const guardsFile = path.join(promptingDir, 'guards.yaml');
    if (!fs.existsSync(guardsFile)) return null;

    try {
      const content = fs.readFileSync(guardsFile, 'utf8');
      this.guardsCache = yaml.load(content) as GuardsConfig;
      return this.guardsCache;
    } catch (err) {
      console.error(`Error loading guards.yaml: ${err}`);
      return null;
    }
  }

  /**
   * Clear guards cache
   */
  clearCache(): void {
    this.guardsCache = null;
  }

  /**
   * Check guards for a command
   */
  async check(command: string, context: GuardContext): Promise<GuardResult> {
    const result: GuardResult = {
      ok: true,
      exitCode: 0,
      output: '',
      checks: [],
      posts: [],
      errors: [],
      warnings: [],
      actions: []
    };

    const config = this.loadConfig();
    if (!config) return result;

    const guard = config[command];
    if (!guard) return result;

    context.command = command;

    const validation = validateContext(command, guard, context);
    if (!validation.valid) {
      result.ok = false;
      result.exitCode = 1;
      result.output = validation.errors.join('\n');
      return result;
    }

    if (guard.checks) {
      for (const check of guard.checks) {
        const checkResult = await evaluateCheck(check, context);
        result.checks.push(checkResult);

        if (checkResult.triggered) {
          if (checkResult.level === 'error') {
            result.errors.push(checkResult);
            result.ok = false;
            if (checkResult.exit) {
              result.exitCode = checkResult.exit;
            }
            break;
          } else if (checkResult.level === 'warn') {
            result.warnings.push(checkResult);
          }

          if (checkResult.actions) {
            result.actions.push(...checkResult.actions);
          }
        }
      }
    }

    result.output = formatGuardOutput(result);
    return result;
  }

  /**
   * Check post-prompts for a command
   */
  async checkPosts(command: string, context: GuardContext): Promise<PostResult[]> {
    const results: PostResult[] = [];

    const config = this.loadConfig();
    if (!config) return results;

    const guard = config[command];
    if (!guard || !guard.posts) return results;

    context.command = command;

    for (const post of guard.posts) {
      const postResult = await evaluatePost(post, context);
      results.push(postResult);
    }

    return results;
  }

  /**
   * Synchronous check (blocking - use async version when possible)
   */
  checkSync(command: string, context: GuardContext): GuardResult {
    let result: GuardResult | null = null;
    let error: Error | null = null;

    const promise = this.check(command, context);
    promise.then(r => { result = r; }).catch(e => { error = e; });

    const start = Date.now();
    while (result === null && error === null && Date.now() - start < 5000) {
      // Busy wait
    }

    if (error) throw error;
    if (!result) {
      return {
        ok: true,
        exitCode: 0,
        output: '',
        checks: [],
        posts: [],
        errors: [],
        warnings: [],
        actions: []
      };
    }

    return result;
  }
}

// Legacy function exports for backward compatibility (delegate to class)
// These will be removed after migration

/**
 * @deprecated Use GuardChecker class instead
 */
export function loadGuardsConfig(startDir: string): GuardsConfig | null {
  return new GuardChecker(startDir).loadConfig();
}

/**
 * @deprecated Use GuardChecker class instead
 */
export function clearGuardsCache(): void {
  // No-op for legacy - each instance has its own cache now
}

/**
 * Validate runtime context against var definitions
 */
function validateContext(
  command: string,
  guard: CommandGuard,
  context: GuardContext
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!guard.vars) return { valid: true, errors: [] };

  for (const [varName, def] of Object.entries(guard.vars)) {
    const value = context[varName];

    // Check required
    if (def.required && value === undefined) {
      errors.push(`Guard '${command}' missing required variable: ${varName}`);
      continue;
    }

    // Apply default if not provided
    if (value === undefined && def.default !== undefined) {
      context[varName] = def.default;
      continue;
    }

    // Type check (loose)
    if (value !== undefined) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (def.type === 'array' && !Array.isArray(value)) {
        errors.push(`Guard '${command}' variable '${varName}' expected array, got ${actualType}`);
      } else if (def.type !== 'array' && def.type !== 'object' && actualType !== def.type) {
        // Loose type checking - allow coercion
        // errors.push(`Guard '${command}' variable '${varName}' expected ${def.type}, got ${actualType}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Evaluate a LiquidJS condition (when clause)
 *
 * Conditions in guards.yaml can use:
 *   - "{{ var == 'value' }}" (will be stripped to just the expression)
 *   - "var == 'value'" (raw expression)
 */
async function evaluateCondition(condition: string, context: GuardContext): Promise<boolean> {
  const liquid = getLiquid();

  // Strip {{ }} if present (for backwards compat with template-style conditions)
  let expr = condition.trim();
  if (expr.startsWith('{{') && expr.endsWith('}}')) {
    expr = expr.slice(2, -2).trim();
  }

  // Wrap condition in an if block to evaluate it
  const template = `{% if ${expr} %}true{% else %}false{% endif %}`;

  try {
    const result = await liquid.parseAndRender(template, context);
    return result.trim() === 'true';
  } catch (err) {
    console.error(`Error evaluating condition '${expr}': ${err}`);
    return false;
  }
}

/**
 * Render a LiquidJS template
 */
async function renderTemplate(template: string, context: GuardContext): Promise<string> {
  const liquid = getLiquid();

  try {
    const result = await liquid.parseAndRender(template, context);
    return result.trim();
  } catch (err) {
    console.error(`Error rendering template: ${err}`);
    return template;  // Return raw template on error
  }
}

/**
 * Evaluate a single check
 */
async function evaluateCheck(
  check: GuardCheck,
  context: GuardContext
): Promise<CheckResult> {
  const triggered = await evaluateCondition(check.when, context);

  const result: CheckResult = {
    id: check.id,
    level: check.level,
    triggered,
    exit: check.exit
  };

  if (triggered) {
    result.message = await renderTemplate(check.message, context);
    if (check.hint) {
      result.hint = await renderTemplate(check.hint, context);
    }
    if (check.actions) {
      result.actions = await Promise.all(
        check.actions.map(async (action) => ({
          cmd: await renderTemplate(action.cmd, context),
          label: await renderTemplate(action.label, context)
        }))
      );
    }
  }

  return result;
}

/**
 * Evaluate a single post
 */
async function evaluatePost(
  post: GuardPost,
  context: GuardContext
): Promise<PostResult> {
  const triggered = await evaluateCondition(post.when, context);

  const result: PostResult = {
    id: post.id,
    level: post.level || 'info',
    triggered
  };

  if (triggered) {
    result.message = await renderTemplate(post.message, context);
    if (post.actions) {
      result.actions = await Promise.all(
        post.actions.map(async (action) => ({
          cmd: await renderTemplate(action.cmd, context),
          label: await renderTemplate(action.label, context)
        }))
      );
    }
  }

  return result;
}

/**
 * Format guard output for console
 */
export function formatGuardOutput(result: GuardResult): string {
  const lines: string[] = [];

  // Errors first
  for (const err of result.errors) {
    if (err.message) {
      lines.push(err.message);
    }
    if (err.hint) {
      lines.push(`\nHint: ${err.hint}`);
    }
    if (err.actions && err.actions.length > 0) {
      lines.push('\nNext steps:');
      for (const action of err.actions) {
        lines.push(`  ${action.cmd.padEnd(35)} # ${action.label}`);
      }
    }
  }

  // Warnings
  for (const warn of result.warnings) {
    if (warn.message) {
      lines.push(warn.message);
    }
    if (warn.actions && warn.actions.length > 0) {
      lines.push('Suggestions:');
      for (const action of warn.actions) {
        lines.push(`  ${action.cmd.padEnd(35)} # ${action.label}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Format post output for console
 */
export function formatPostOutput(posts: PostResult[]): string {
  const lines: string[] = [];

  for (const post of posts) {
    if (!post.triggered) continue;

    if (post.message) {
      lines.push(post.message);
    }
    if (post.actions && post.actions.length > 0) {
      for (const action of post.actions) {
        lines.push(`  ${action.cmd.padEnd(35)} # ${action.label}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Main entry point: check guards for a command
 *
 * @param command - Command name (e.g., 'agent:spawn')
 * @param context - Runtime variables
 * @param startDir - Directory to start searching for guards.yaml (required for purity)
 * @returns Guard evaluation result
 */
export async function checkGuards(
  command: string,
  context: GuardContext,
  startDir: string
): Promise<GuardResult> {
  return new GuardChecker(startDir).check(command, context);
}

/**
 * Evaluate post-prompts for a command
 *
 * @param command - Command name
 * @param context - Runtime variables (including result state)
 * @param startDir - Directory to start searching for guards.yaml (required for purity)
 * @returns Post evaluation results
 */
export async function checkPosts(
  command: string,
  context: GuardContext,
  startDir: string
): Promise<PostResult[]> {
  return new GuardChecker(startDir).checkPosts(command, context);
}

/**
 * Synchronous wrapper for checkGuards (for simpler integration)
 *
 * Note: This uses a sync hack and should be avoided if possible.
 * Prefer the async checkGuards() in new code.
 * @param startDir - Directory to start searching for guards.yaml (required for purity)
 */
export function checkGuardsSync(
  command: string,
  context: GuardContext,
  startDir: string
): GuardResult {
  return new GuardChecker(startDir).checkSync(command, context);
}

/**
 * Helper: Create guard context from common CLI patterns
 */
export function createGuardContext(
  baseContext: Partial<GuardContext>,
  runtimeVars: Record<string, unknown>
): GuardContext {
  return {
    ...baseContext,
    ...runtimeVars
  } as GuardContext;
}

/**
 * Helper: Print guard result and exit if needed
 */
export function handleGuardResult(result: GuardResult): void {
  if (!result.ok) {
    console.error(result.output);
    process.exit(result.exitCode);
  }

  // Print warnings
  if (result.warnings.length > 0) {
    for (const warn of result.warnings) {
      if (warn.message) {
        console.warn(warn.message);
      }
    }
  }
}
