/**
 * Shared TypeScript interfaces for the rudder CLI
 */

export interface AgentInfo {
  status: string;
  pid?: number;
  worktree?: {
    path: string;
    branch: string;
    base_branch?: string;
    branching?: string;
  };
  pr_url?: string;
  task_title?: string;
  epic_id?: string;
  prd_id?: string;
  mission_file?: string;
  log_file?: string;
  srt_config?: string;
  mcp_config?: string;
  mcp_server?: string;
  mcp_port?: number;
  mcp_pid?: number;
  timeout?: number;
  started_at?: string;
  completed_at?: string;
  spawned_at?: string;
  ended_at?: string;
  exit_code?: number;
  exit_signal?: string | null;
  dirty_worktree?: boolean;
  uncommitted_files?: number;
  merged_at?: string;
  rejected_at?: string;
  cleaned_at?: string;
  killed_at?: string;
  merge_strategy?: string;
  merged_to?: string;
  [key: string]: any;
}
