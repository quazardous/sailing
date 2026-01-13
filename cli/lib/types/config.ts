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