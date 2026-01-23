/**
 * Task Command Option Types
 *
 * Type definitions for task command handlers.
 */

export interface TaskListOptions {
  status?: string;
  epic?: string;
  assignee?: string;
  tag?: string[];
  ready?: boolean;
  limit?: number;
  prd?: string;
  path?: boolean;
  json?: boolean;
}

export interface EpicParentInfo {
  prdDir: string;
  epicFile: string;
  prdId: string;
}

export interface TaskShowAgentResult {
  id: string;
  title: string;
  status: string;
  parent: string;
  file?: string;
}

export interface TaskShowFullResult {
  id?: string;
  title?: string;
  status?: string;
  parent?: string;
  blockers: string[];
  dependents: string[];
  ready: boolean;
  file?: string;
  [key: string]: unknown;
}

export interface TaskCreateOptions {
  story?: string[];
  tag?: string[];
  targetVersion?: string[];
  path?: boolean;
  json?: boolean;
}

export interface TaskUpdateOptions {
  title?: string;
  status?: string;
  assignee?: string;
  effort?: string;
  priority?: string;
  addBlocker?: string[];
  blockedBy?: string;
  removeBlocker?: string[];
  clearBlockers?: boolean;
  story?: string[];
  addStory?: string[];
  removeStory?: string[];
  targetVersion?: string[];
  removeTargetVersion?: string[];
  set?: string[];
  json?: boolean;
}

export interface TaskNextOptions {
  prd?: string;
  epic?: string;
  path?: boolean;
  json?: boolean;
}

export interface TaskWithPriority {
  id: string;
  title: string;
  status: string;
  parent: string;
  assignee: string;
  priority: string;
  prd?: string;
  file?: string;
}

export interface TaskStartOptions {
  assignee: string;
  path?: boolean;
  json?: boolean;
}

export interface TaskDoneOptions {
  message: string;
  json?: boolean;
}

export interface TaskShowOptions {
  role?: string;
  raw?: boolean;
  stripComments?: boolean;
  path?: boolean;
  json?: boolean;
}

export interface TaskShowMemoryOptions {
  json?: boolean;
}

export interface TaskLogOptions {
  info?: boolean;
  tip?: boolean;
  warn?: boolean;
  error?: boolean;
  critical?: boolean;
  file?: string[];
  snippet?: string;
  cmd?: string;
}

export interface TaskTargetsOptions {
  path?: boolean;
  json?: boolean;
}

export interface TaskPatchOptions {
  file?: string;
  dryRun?: boolean;
  json?: boolean;
}

export interface TaskEditOptions {
  section?: string;
  content?: string;
  append?: boolean;
  prepend?: boolean;
  json?: boolean;
}
