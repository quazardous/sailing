/**
 * Agent State Machine
 *
 * Re-exports from modular state-machine components.
 * For new code, prefer importing directly from './state-machine/index.js'
 */
// Re-export everything from the state-machine module
export { 
// States and events
AgentState, WorktreeState, AgentEvent, isTerminalState, stateLabel, stateSymbol, 
// Transitions
transitions, getValidEvents, getTransition, hasTransition, 
// Guards
guards, runGuards, 
// State machine
AgentStateMachine, 
// Diagnostics
diagnoseWorktreeState, diagnoseAgentState, getRecommendedActions, 
// Recovery
mergeStrategies, errorRecovery, getRecoveryStrategy, getMergeStrategy, listMergeStrategies, listErrorTypes, 
// Documentation
stateDiagram } from './state-machine/index.js';
