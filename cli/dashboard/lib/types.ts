/**
 * Dashboard types
 */

export interface TaskData {
  id: string;
  title: string;
  status: string;
  description: string;
  meta: Record<string, unknown>;
  createdAt?: string;
  modifiedAt?: string;
}

export interface EpicData {
  id: string;
  title: string;
  status: string;
  description: string;
  meta: Record<string, unknown>;
  tasks: TaskData[];
  createdAt?: string;
  modifiedAt?: string;
}

export interface PrdData {
  id: string;
  title: string;
  status: string;
  description: string;
  meta: Record<string, unknown>;
  epics: EpicData[];
  totalTasks: number;
  doneTasks: number;
  progress: number;
  createdAt?: string;
  modifiedAt?: string;
}

export interface BlockerData {
  type: string;
  id: string;
  title: string;
  reason: string;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// Gantt task interfaces
export interface SailingGanttTask {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  durationHours: number;
  status: string;
  dependencies: string[];
  blocks: string[];
  isCritical: boolean;
  epicId?: string;
  epicTitle?: string;
  startedAt?: string;
  doneAt?: string;
}

export interface SimpleGanttTask {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  durationHours: number;      // Total effort (sum of task durations)
  doneEffortHours?: number;   // Effort completed (sum of Done task durations)
  status: string;
  progress?: number;          // Progress based on effort (doneEffortHours / durationHours)
  startedAt?: string;
  doneAt?: string;
  criticalTimespanHours?: number;  // Critical path span (theoretical minimum)
}

export interface GanttResult {
  tasks: SailingGanttTask[];
  criticalPath: string[];
  title: string;
  totalHours: number;
  t0: Date;
  durationHours: number;
  criticalTimespanHours: number;
}

export interface SimpleGanttResult {
  tasks: SimpleGanttTask[];
  totalHours: number;
  t0: Date;
}

export interface DagResult {
  code: string;
  tooltips: Record<string, string>;
}

// Structured DAG types (for Vue dashboard)
export interface DagNode {
  id: string;
  type: 'prd' | 'epic' | 'task';
  title: string;
  status: string;
  level: number;
}

export interface DagEdge {
  from: string;
  to: string;
  type: 'hierarchy' | 'dependency';
}

export interface StructuredDagResult {
  nodes: DagNode[];
  edges: DagEdge[];
  criticalPath?: string[];
}

/**
 * Effort configuration (for Gantt scheduling)
 */
export interface EffortConfig {
  default_duration: string;
  effort_map: string;
}
