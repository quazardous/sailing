/**
 * Guard system types
 *
 * Defines the structure for guards.yaml and runtime evaluation.
 */

// Variable definition in guards.yaml
export interface VarDefinition {
  type: 'string' | 'boolean' | 'number' | 'array' | 'object';
  required?: boolean;
  default?: unknown;
}

// Action recommendation
export interface GuardAction {
  cmd: string;
  label: string;
}

// Single check definition
export interface GuardCheck {
  id: string;
  when: string;  // LiquidJS condition
  level: 'error' | 'warn' | 'info';
  message: string;  // LiquidJS template
  hint?: string;
  actions?: GuardAction[];
  exit?: number;
}

// Post-prompt definition
export interface GuardPost {
  id: string;
  when: string;  // LiquidJS condition
  level?: 'warn' | 'info';
  message: string;  // LiquidJS template
  actions?: GuardAction[];
}

// Command guard definition (from guards.yaml)
export interface CommandGuard {
  vars?: Record<string, VarDefinition>;
  checks?: GuardCheck[];
  posts?: GuardPost[];
}

// Full guards.yaml structure
export type GuardsConfig = Record<string, CommandGuard>;

// Runtime evaluation result for a single check
export interface CheckResult {
  id: string;
  level: 'error' | 'warn' | 'info';
  triggered: boolean;
  message?: string;
  hint?: string;
  actions?: GuardAction[];
  exit?: number;
}

// Runtime evaluation result for a single post
export interface PostResult {
  id: string;
  level: 'warn' | 'info';
  triggered: boolean;
  message?: string;
  actions?: GuardAction[];
}

// Full guard evaluation result
export interface GuardResult {
  ok: boolean;
  exitCode: number;
  output: string;           // Formatted output for console
  checks: CheckResult[];    // All check results
  posts: PostResult[];      // All post results (for later use)
  errors: CheckResult[];    // Triggered errors
  warnings: CheckResult[];  // Triggered warnings
  actions: GuardAction[];   // All recommended actions
}

// Runtime context passed to guards
export interface GuardContext {
  // Implicit variables (always available)
  config?: Record<string, unknown>;
  role?: 'agent' | 'skill' | 'coordinator';
  command?: string;

  // Runtime variables (declared in vars)
  [key: string]: unknown;
}
