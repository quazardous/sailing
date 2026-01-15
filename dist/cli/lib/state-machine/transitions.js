/**
 * State Transition Table
 *
 * Declarative definition of all valid state transitions.
 * Format: [currentState][event] → { next, guards?, actions?, worktree? }
 */
import { AgentState, AgentEvent, WorktreeState } from './states.js';
/**
 * Transition definitions
 */
export const transitions = {
    [AgentState.IDLE]: {
        [AgentEvent.SPAWN]: {
            next: AgentState.DISPATCHED,
            guards: ['hasGit', 'hasGitRepo', 'noExistingWorktree', 'branchAvailable'],
            actions: ['createWorktree', 'initState'],
            worktree: { from: WorktreeState.NONE, to: WorktreeState.CLEAN }
        }
    },
    [AgentState.DISPATCHED]: {
        [AgentEvent.START]: {
            next: AgentState.RUNNING,
            guards: ['worktreeExists'],
            actions: ['spawnProcess', 'updateState']
        },
        [AgentEvent.KILL]: {
            next: AgentState.KILLED,
            actions: ['updateState']
        },
        [AgentEvent.REJECT]: {
            next: AgentState.REJECTED,
            actions: ['removeWorktree', 'updateState'],
            worktree: { from: '*', to: WorktreeState.REMOVED }
        }
    },
    [AgentState.RUNNING]: {
        [AgentEvent.COMPLETE]: {
            next: AgentState.COMPLETED,
            actions: ['updateState'],
            worktree: { from: WorktreeState.CLEAN, to: WorktreeState.COMMITTED }
        },
        [AgentEvent.FAIL]: {
            next: AgentState.FAILED,
            actions: ['updateState']
        },
        [AgentEvent.KILL]: {
            next: AgentState.KILLED,
            actions: ['killProcess', 'updateState']
        }
    },
    [AgentState.COMPLETED]: {
        [AgentEvent.MERGE]: {
            next: AgentState.MERGING,
            guards: ['worktreeExists', 'hasCommits', 'worktreeClean'],
            actions: ['startMerge']
        },
        [AgentEvent.REJECT]: {
            next: AgentState.REJECTED,
            actions: ['removeWorktree', 'deleteBranch', 'updateState'],
            worktree: { from: '*', to: WorktreeState.REMOVED }
        }
    },
    [AgentState.FAILED]: {
        [AgentEvent.REJECT]: {
            next: AgentState.REJECTED,
            actions: ['removeWorktree', 'deleteBranch', 'updateState'],
            worktree: { from: '*', to: WorktreeState.REMOVED }
        },
        [AgentEvent.MERGE]: {
            next: AgentState.MERGING,
            guards: ['worktreeExists', 'hasCommits'],
            actions: ['startMerge']
        }
    },
    [AgentState.KILLED]: {
        [AgentEvent.CLEANUP]: {
            next: AgentState.REJECTED,
            actions: ['removeWorktree', 'deleteBranch', 'updateState'],
            worktree: { from: '*', to: WorktreeState.REMOVED }
        }
    },
    [AgentState.MERGING]: {
        [AgentEvent.MERGE_OK]: {
            next: AgentState.MERGED,
            actions: ['removeWorktree', 'deleteBranch', 'updateState'],
            worktree: { from: '*', to: WorktreeState.REMOVED }
        },
        [AgentEvent.MERGE_CONFLICT]: {
            next: AgentState.CONFLICT,
            actions: ['updateState'],
            worktree: { from: '*', to: WorktreeState.CONFLICT }
        }
    },
    [AgentState.CONFLICT]: {
        [AgentEvent.RESOLVE]: {
            next: AgentState.MERGING,
            guards: ['conflictResolved'],
            actions: ['commitResolution', 'continueMerge']
        },
        [AgentEvent.ABORT]: {
            next: AgentState.COMPLETED,
            actions: ['abortMerge', 'updateState'],
            worktree: { from: WorktreeState.CONFLICT, to: WorktreeState.COMMITTED }
        },
        [AgentEvent.REJECT]: {
            next: AgentState.REJECTED,
            actions: ['abortMerge', 'removeWorktree', 'deleteBranch', 'updateState'],
            worktree: { from: '*', to: WorktreeState.REMOVED }
        }
    },
    // Terminal states - no transitions out
    [AgentState.MERGED]: {},
    [AgentState.REJECTED]: {},
    [AgentState.ERROR]: {}
};
/**
 * Get valid events for a state
 */
export function getValidEvents(state) {
    return Object.keys(transitions[state] || {});
}
/**
 * Get transition definition
 */
export function getTransition(state, event) {
    return transitions[state]?.[event] || null;
}
/**
 * Check if transition exists
 */
export function hasTransition(state, event) {
    return !!getTransition(state, event);
}
