/**
 * Shared TypeScript interfaces for workflows.yaml
 */

export interface WorkflowCommand {
  cmd: string;
  purpose: string;
  mode: 'inline' | 'subprocess' | 'both';
  required?: boolean;
  condition?: string;
  output?: string;
  note?: string;
}

export interface WorkflowPhase {
  name: string;
  actor: 'skill' | 'agent';
  commands: WorkflowCommand[];
}

export interface OperationMeta {
  description: string;
  entity: 'task' | 'epic' | 'prd';
  roles?: string[]; // New format
  role?: string;    // Old format
}

export interface RoleDefinition {
    description: string;
    base_sets: string[];
    workflow: boolean;
    inject?: Record<string, unknown>; // Can be refined later
}

export interface WorkflowsConfig {
  roles: Record<string, RoleDefinition>;
  sets: Record<string, string[]>;
  operations: Record<string, OperationMeta>;
  matrix: Record<string, string[]>;
  orchestration: Record<string, WorkflowPhase[]>;
}
