/**
 * Shared TypeScript interfaces for project entities (Task, Epic, etc.)
 */

export interface BaseEntity {
  id: string;
  title: string;
  status: string;
  parent: string;
  tags?: string[];
}

export interface Task extends BaseEntity {
  assignee?: string;
  blocked_by?: string[];
  stories?: string[];
  effort?: string; // Duration (e.g., "4h") or legacy T-shirt size (S, M, L, XL)
  priority?: 'low' | 'normal' | 'high' | 'critical';
  target_versions?: Record<string, string>;
}

export interface Epic extends BaseEntity {
  stories?: string[];
  milestone?: string;
  target_versions?: Record<string, string>;
  blocked_by?: string[];
}

export interface Prd extends BaseEntity {
  milestones?: { id: string; epics: string[] }[];
  branching?: 'flat' | 'prd' | 'epic';
}

export interface Story extends BaseEntity {
  type: 'user' | 'technical' | 'api';
  parent_story?: string | null;
}

export interface TaskIndexEntry {
  key: string;
  id: string;
  file: string;
  prdDir: string;
  data: Partial<Task>;
}

export interface EpicIndexEntry {
  key: string;
  id: string;
  file: string;
  prdDir: string;
  data: Partial<Epic>;
}

export interface PrdIndexEntry {
  num: number;
  id: string;
  dir: string;
  file: string;
  data: Partial<Prd>;
}

export interface StoryIndexEntry {
  key: string;
  id: string;
  file: string;
  prdDir: string;
  data: Partial<Story>;
}

/**
 * Full task with all metadata for display/scheduling
 */
export interface FullTask {
  id: string;
  title: string;
  status: string;
  description: string;
  meta: Record<string, unknown>;
}

/**
 * Full epic with its tasks
 */
export interface FullEpic {
  id: string;
  title: string;
  status: string;
  description: string;
  meta: Record<string, unknown>;
  tasks: FullTask[];
}

/**
 * Full PRD with epics and tasks hierarchy
 */
export interface FullPrd {
  id: string;
  title: string;
  status: string;
  description: string;
  meta: Record<string, unknown>;
  epics: FullEpic[];
  totalTasks: number;
  doneTasks: number;
  progress: number;
}