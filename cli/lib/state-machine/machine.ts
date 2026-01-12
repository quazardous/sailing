/**
 * Agent State Machine Engine
 *
 * Manages state transitions with validation and history tracking.
 */
import { AgentState, WorktreeState, isTerminalState } from './states.js';
import { transitions, getTransition, getValidEvents } from './transitions.js';
import { guards, runGuards } from './guards.js';

/**
 * State Machine Engine
 */
interface HistoryItem {
  from: string;
  event: string;
  to: string;
  timestamp: string;
}

export class AgentStateMachine {
  taskId: string;
  state: string;
  worktreeState: string;
  history: HistoryItem[];
  context: Record<string, any>;

  constructor(taskId: string, initialState = AgentState.IDLE) {
    this.taskId = taskId;
    this.state = initialState;
    this.worktreeState = WorktreeState.NONE;
    this.history = [];
    this.context = {};
  }

  /**
   * Check if a transition is valid
   * @returns {{ valid: boolean, errors: string[] }}
   */
  canTransition(event) {
    const transition = getTransition(this.state, event);

    if (!transition) {
      const validEvents = getValidEvents(this.state);
      return {
        valid: false,
        errors: [
          `Invalid event '${event}' in state '${this.state}'`,
          validEvents.length > 0
            ? `Valid events: ${validEvents.join(', ')}`
            : 'No transitions available from this state'
        ]
      };
    }

    // Check guards
    if (transition.guards) {
      const result = runGuards(transition.guards, this.context);
      if (!result.ok) {
        return { valid: false, errors: result.errors };
      }
    }

    return { valid: true, errors: [] };
  }

  /**
   * Execute a transition
   * @returns {{ success: boolean, state: string, errors?: string[], actions?: string[] }}
   */
  transition(event, context = {}) {
    // Update context
    this.context = { ...this.context, ...context };

    const check = this.canTransition(event);
    if (!check.valid) {
      return { success: false, state: this.state, errors: check.errors };
    }

    const transition = getTransition(this.state, event);
    const previousState = this.state;

    // Record history
    this.history.push({
      from: previousState,
      event,
      to: transition.next,
      timestamp: new Date().toISOString()
    });

    // Update state
    this.state = transition.next;

    // Update worktree state if specified
    if (transition.worktree) {
      this.worktreeState = transition.worktree.to;
    }

    return {
      success: true,
      state: this.state,
      previousState,
      actions: transition.actions || []
    };
  }

  /**
   * Get valid events for current state
   */
  getValidEvents() {
    return getValidEvents(this.state);
  }

  /**
   * Check if in terminal state
   */
  isTerminal() {
    return isTerminalState(this.state);
  }

  /**
   * Get transition history
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * Get last transition
   */
  getLastTransition() {
    return this.history[this.history.length - 1] || null;
  }

  /**
   * Export state for persistence
   */
  toJSON() {
    return {
      taskId: this.taskId,
      state: this.state,
      worktreeState: this.worktreeState,
      history: this.history,
      context: this.context
    };
  }

  /**
   * Restore from persisted state
   */
  static fromJSON(data) {
    const machine = new AgentStateMachine(data.taskId, data.state);
    machine.worktreeState = data.worktreeState || WorktreeState.NONE;
    machine.history = data.history || [];
    machine.context = data.context || {};
    return machine;
  }
}
