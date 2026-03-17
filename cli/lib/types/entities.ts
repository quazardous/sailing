/**
 * Shared TypeScript interfaces for project entities (Task, Epic, etc.)
 */

export interface BaseEntity {
  [key: string]: unknown;  // Allow index access for frontmatter operations
  id: string;
  title: string;
  status: string;
  parent: string;
  tags?: string[];
  created_at?: string;  // ISO date string, set at creation
  updated_at?: string;  // ISO date string, auto-updated on save
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

export interface Panic extends BaseEntity {
  scope: string;
  source: 'agent' | 'framework';
  severity?: 'critical' | 'high';
  resolved_at?: string;
}

/** File timestamps */
export interface FileTimestamps {
  createdAt: string;   // ISO date string
  modifiedAt: string;  // ISO date string
}

export interface TaskIndexEntry extends FileTimestamps {
  key: string;
  id: string;
  file: string;
  prdId: string;
  epicId: string | null;  // Normalized epic ID extracted from parent
  prdDir: string;  // Internal use only - managers
  data: Partial<Task>;
}

export interface EpicIndexEntry extends FileTimestamps {
  key: string;
  id: string;
  file: string;
  prdId: string;
  prdDir: string;  // Internal use only - managers
  data: Partial<Epic>;
}

export interface PrdIndexEntry extends FileTimestamps {
  num: number;
  id: string;
  dir: string;
  file: string;
  data: Partial<Prd>;
}

export interface StoryIndexEntry extends FileTimestamps {
  key: string;
  id: string;
  file: string;
  prdId: string;
  prdDir: string;  // Internal use only - managers
  data: Partial<Story>;
}

export interface PanicIndexEntry extends FileTimestamps {
  key: string;
  id: string;
  file: string;
  prdId: string;
  prdDir: string;
  data: Partial<Panic>;
}

export interface ArchiveEntry extends FileTimestamps {
  key: string;       // numeric key: "364", "1", "97"
  id: string;        // normalized: T00364, E0097, PRD-013
  type: 'task' | 'epic' | 'prd';
  title: string;
  status: string;
  parent: string;    // "PRD-013 / E0082"
  prdId: string;     // "PRD-013"
  file: string;      // absolute path
}

/**
 * Full task with all metadata for display/scheduling
 */
export interface FullTask extends FileTimestamps {
  id: string;
  title: string;
  status: string;
  description: string;
  meta: Record<string, unknown>;
}

/**
 * Full epic with its tasks
 */
export interface FullEpic extends FileTimestamps {
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
export interface FullPrd extends FileTimestamps {
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