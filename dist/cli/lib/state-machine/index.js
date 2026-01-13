/**
 * State Machine Module
 *
 * Exports all state machine components for agent lifecycle management.
 */
// States and events
export { AgentState, WorktreeState, AgentEvent, isTerminalState, stateLabel, stateSymbol } from './states.js';
// Transition table
export { transitions, getValidEvents, getTransition, hasTransition } from './transitions.js';
// Guard functions
export { guards, runGuards } from './guards.js';
// State machine engine
export { AgentStateMachine } from './machine.js';
// Diagnostic functions
export { diagnoseWorktreeState, diagnoseAgentState, getRecommendedActions } from './diagnosis.js';
// Recovery strategies
export { mergeStrategies, errorRecovery, getRecoveryStrategy, getMergeStrategy, listMergeStrategies, listErrorTypes } from './recovery.js';
/**
 * State Diagram (Mermaid format for documentation)
 */
export const stateDiagram = `
stateDiagram-v2
    [*] --> idle

    idle --> dispatched: spawn [hasGit, noWorktree]

    dispatched --> running: start
    dispatched --> killed: kill
    dispatched --> rejected: reject

    running --> completed: complete
    running --> failed: fail
    running --> killed: kill

    completed --> merging: merge [hasCommits]
    completed --> rejected: reject

    failed --> rejected: reject
    failed --> merging: merge [hasCommits]

    killed --> rejected: cleanup

    merging --> merged: merge_ok
    merging --> conflict: merge_conflict

    conflict --> merging: resolve
    conflict --> completed: abort
    conflict --> rejected: reject

    merged --> [*]
    rejected --> [*]
`;
