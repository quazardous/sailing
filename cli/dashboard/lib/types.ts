/**
 * Dashboard types
 */

export interface TaskData {
  id: string;
  title: string;
  status: string;
  description: string;
  meta: Record<string, unknown>;
}

export interface EpicData {
  id: string;
  title: string;
  status: string;
  description: string;
  meta: Record<string, unknown>;
  tasks: TaskData[];
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
  durationHours: number;
  status: string;
  progress?: number;
  startedAt?: string;
  criticalTimespanHours?: number;
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
