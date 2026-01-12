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
  effort?: 'S' | 'M' | 'L' | 'XL';
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
}

export interface Story extends BaseEntity {
  type: 'user' | 'technical' | 'api';
  parent_story?: string | null;
}
