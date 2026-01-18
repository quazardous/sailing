/**
 * Shared TypeScript interfaces for the rudder CLI
 */

/**
 * AgentRecord - New normalized structure using taskNum as primary key
 *
 * Design principles:
 * - taskNum (number) is the primary key, survives nomenclature changes (TNNN → TNNNN)
 * - agent_dir stores the absolute path to agent directory (all other paths derived)
 * - worktree.path and worktree.branch are absolute values (survive convention changes)
 * - No redundant fields: task_title, epic_id, prd_id read from task file when needed
 * - No git-derived fields: dirty_worktree, uncommitted_files computed on demand
 */
export interface AgentRecord {
  /** Primary key: numeric part of task ID (5 for T005) */
  taskNum: number;
  /** Agent status */
  status: string;
  /** Process ID when running */
  pid?: number;
  /** Agent directory path (e.g., /home/.../.haven/agents/T005) */
  agent_dir?: string;
  /** Worktree info (absolute paths, survive convention changes) */
  worktree?: {
    path: string;
    branch: string;
    base_branch?: string;
    branching?: string;
  };
  /** PR/MR URL */
  pr_url?: string;
  /** MCP server info */
  mcp_server?: string;
  mcp_port?: number;
  mcp_pid?: number;
  /** Timeout in seconds */
  timeout?: number;
  /** Timestamps */
  spawned_at?: string;
  started_at?: string;
  completed_at?: string;
  ended_at?: string;
  merged_at?: string;
  rejected_at?: string;
  cleaned_at?: string;
  killed_at?: string;
  orphaned_at?: string;
  reaped_at?: string;
  pr_created_at?: string;
  /** Exit info */
  exit_code?: number;
  exit_signal?: string | null;
  /** Result info */
  result_status?: string;
  reject_reason?: string;
  /** Merge info */
  merge_strategy?: string;
  merged_to?: string;
  worktree_merged?: boolean;
  /** Allow additional fields for backwards compat */
  [key: string]: unknown;
}

