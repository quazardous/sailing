/**
 * API Types for Dashboard
 */

// Artefact types
export type ArtefactType = 'prd' | 'epic' | 'task';
export type ArtefactStatus = 'Draft' | 'Todo' | 'In Progress' | 'WIP' | 'Blocked' | 'Done';

export interface TaskData {
  id: string;
  title: string;
  status: ArtefactStatus;
  description?: string;
  meta?: Record<string, unknown>;
  createdAt?: string;
  modifiedAt?: string;
}

export interface EpicData {
  id: string;
  title: string;
  status: ArtefactStatus;
  description?: string;
  meta?: Record<string, unknown>;
  tasks: TaskData[];
  createdAt?: string;
  modifiedAt?: string;
}

export interface PrdData {
  id: string;
  title: string;
  status: ArtefactStatus;
  description?: string;
  meta?: Record<string, unknown>;
  progress: number;
  totalTasks: number;
  doneTasks: number;
  epics: EpicData[];
  createdAt?: string;
  modifiedAt?: string;
}

// Tree response
export interface TreeNode {
  id: string;
  title: string;
  type: ArtefactType;
  status: ArtefactStatus;
  progress?: number;
  children?: TreeNode[];
}

export interface TreeResponse {
  prds: PrdData[];
}

// DAG data for dependency graph
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

export interface DagData {
  nodes: DagNode[];
  edges: DagEdge[];
  criticalPath?: string[];
}

// Artefact detail response
export interface ArtefactResponse {
  type: ArtefactType;
  data: PrdData | EpicData | TaskData;
  dag?: DagData;
  gantt?: GanttData;
  parent?: {
    id: string;
    title: string;
    type: ArtefactType;
  };
}

// Gantt data (matches API response)
export interface GanttTask {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  durationHours: number;
  status: string;
  isCritical: boolean;
  dependencies: string[];
}

export interface GanttData {
  tasks: GanttTask[];
  criticalPath: string[];
  totalHours: number;
  t0: string;
  durationHours: number;
  criticalTimespanHours: number;
}

// Agent types
export type AgentStatus = 'running' | 'completed' | 'failed' | 'pending' | 'reaped' | 'killed' | 'orphaned' | string;

export interface AgentInfo {
  taskId: string;
  status: AgentStatus;
  startedAt?: string;
  completedAt?: string;
  reapedAt?: string;
  pid?: number;
  worktree?: string;
  exitCode?: number;
}

export interface AgentsResponse {
  agents: AgentInfo[];
}

// WebSocket message types
export type WsMessageType =
  | 'agent:log'
  | 'agent:status'
  | 'artefact:updated'
  | 'connected'
  | 'error';

export interface WsMessage {
  type: WsMessageType;
  taskId?: string;
  line?: string;
  status?: AgentStatus;
  id?: string;
  artefactType?: ArtefactType;
  message?: string;
  timestamp?: string;
}

// Project info
export interface ProjectInfo {
  path: string;
  relativePath: string;
  name: string;
}

// API response wrapper
export interface ApiResponse<T> {
  data: T;
  error?: string;
}
