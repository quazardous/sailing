/**
 * Shared config-related types
 */

export interface ConfigSchemaEntry {
  type: string;
  default: unknown;
  description: string;
  values?: unknown[];
}

export type ConfigSchema = Record<string, ConfigSchemaEntry>;

export interface ConfigDisplayItem {
  key: string;
  value: unknown;
  default: unknown;
  description: string;
  type: string;
  values?: unknown[];
  isDefault: boolean;
}

export interface PathInfo {
  path: string | null;
  configured?: string | null;
  type: string;
  isCustom: boolean;
  isAbsolute: boolean;
}

export interface ConfigInfo {
  projectRoot: string;
  sailingDir: string;
  pathsConfigPath: string;
  pathsConfigExists: boolean;
  cliPath: string;
  paths: Record<string, PathInfo>;
}

export interface PathDetails {
  template: string;
  relative: string;
  absolute: string;
}

export type PathsInfo = Record<string, PathDetails>;

export interface CheckEntry {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

export interface CheckState {
  status: 'ok' | 'warn' | 'error';
  counters?: { prd?: number; epic?: number; task?: number; story?: number };
  message?: string;
}

export interface CheckResults {
  git: CheckEntry[];
  directories: CheckEntry[];
  files: CheckEntry[];
  yaml: CheckEntry[];
  state: CheckState | null;
  config: CheckEntry[];
  summary: { ok: number; warn: number; error: number };
}

export interface Placeholders {
  home: string;
  project: string;
  project_name: string;
  project_hash: string;
  haven: string;
  sibling: string;
  [key: string]: string; // Allow custom placeholders
}

type MergeStrategy = 'squash' | 'merge' | 'rebase';
type SquashLevel = 'task' | 'epic' | 'prd';
type ClaudeModel = 'sonnet' | 'opus' | 'haiku';
type PRProvider = 'auto' | 'github' | 'gitlab';
type MCPMode = 'socket' | 'port';
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SailingConfig {
  git: {
    main_branch: string;
    sync_before_spawn: boolean;
    merge_to_main: MergeStrategy;
    merge_to_prd: MergeStrategy;
    merge_to_epic: MergeStrategy;
    squash_level: SquashLevel;
  };
  agent: {
    use_subprocess: boolean;
    use_worktrees: boolean;
    risky_mode: boolean;
    sandbox: boolean;
    timeout: number;
    merge_strategy: MergeStrategy;
    model: ClaudeModel;
    max_parallel: number;
    auto_merge: boolean;
    auto_pr: boolean;
    pr_draft: boolean;
    pr_provider: PRProvider;
    mcp_mode: MCPMode;
    mcp_port_range: string;
    max_budget_usd: number;
    watchdog_timeout: number;
    auto_diagnose: boolean;
  };
  output: {
    color: boolean;
    verbose: number;
  };
  logging: {
    level: LogLevel;
  };
  ids: {
    prd_digits: number;
    epic_digits: number;
    task_digits: number;
    story_digits: number;
  };
}
