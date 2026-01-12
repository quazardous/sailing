/**
 * Agent & Worktree States and Events
 */

/**
 * Agent States
 */
export const AgentState = {
  IDLE: 'idle',
  DISPATCHED: 'dispatched',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  KILLED: 'killed',
  MERGING: 'merging',
  MERGED: 'merged',
  CONFLICT: 'conflict',
  REJECTED: 'rejected',
  ERROR: 'error'
};

/**
 * Worktree States
 */
export const WorktreeState = {
  NONE: 'none',
  CREATING: 'creating',
  CLEAN: 'clean',
  DIRTY: 'dirty',
  COMMITTED: 'committed',
  CONFLICT: 'conflict',
  REMOVED: 'removed'
};

/**
 * Events that trigger transitions
 */
export const AgentEvent = {
  SPAWN: 'spawn',
  START: 'start',
  COMPLETE: 'complete',
  FAIL: 'fail',
  KILL: 'kill',
  MERGE: 'merge',
  MERGE_OK: 'merge_ok',
  MERGE_CONFLICT: 'merge_conflict',
  RESOLVE: 'resolve',
  ABORT: 'abort',
  REJECT: 'reject',
  CLEANUP: 'cleanup'
};

/**
 * Check if state is terminal
 */
export function isTerminalState(state) {
  return [AgentState.MERGED, AgentState.REJECTED, AgentState.ERROR].includes(state);
}

/**
 * Get human-readable state label
 */
export function stateLabel(state) {
  const labels = {
    [AgentState.IDLE]: 'Idle',
    [AgentState.DISPATCHED]: 'Dispatched',
    [AgentState.RUNNING]: 'Running',
    [AgentState.COMPLETED]: 'Completed',
    [AgentState.FAILED]: 'Failed',
    [AgentState.KILLED]: 'Killed',
    [AgentState.MERGING]: 'Merging',
    [AgentState.MERGED]: 'Merged',
    [AgentState.CONFLICT]: 'Conflict',
    [AgentState.REJECTED]: 'Rejected',
    [AgentState.ERROR]: 'Error'
  };
  return labels[state] || state;
}

/**
 * Get state symbol for display
 */
export function stateSymbol(state) {
  const symbols = {
    [AgentState.IDLE]: '○',
    [AgentState.DISPATCHED]: '◐',
    [AgentState.RUNNING]: '●',
    [AgentState.COMPLETED]: '✓',
    [AgentState.FAILED]: '✗',
    [AgentState.KILLED]: '⊘',
    [AgentState.MERGING]: '⟳',
    [AgentState.MERGED]: '✓',
    [AgentState.CONFLICT]: '⚠',
    [AgentState.REJECTED]: '✗',
    [AgentState.ERROR]: '!'
  };
  return symbols[state] || '?';
}
