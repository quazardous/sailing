/**
 * Event Bus - Internal pub/sub for decoupling components
 *
 * Events emitted:
 * - agent:spawned   - Agent process started
 * - agent:log       - New log line from agent
 * - agent:completed - Agent process finished
 * - agent:killed    - Agent forcefully terminated
 * - agent:reaped    - Agent work merged
 * - task:updated    - Task status changed
 */

export type EventType =
  | 'agent:spawned'
  | 'agent:log'
  | 'agent:completed'
  | 'agent:killed'
  | 'agent:reaped'
  | 'task:updated';

export interface AgentSpawnedEvent {
  taskId: string;
  pid: number;
  worktree?: {
    path: string;
    branch: string;
  };
  timestamp: string;
}

export interface AgentLogEvent {
  taskId: string;
  line: string;
  level?: 'info' | 'warn' | 'error' | 'debug';
  timestamp: string;
}

export interface AgentCompletedEvent {
  taskId: string;
  exitCode: number | null;
  exitSignal: string | null;
  resultStatus?: 'completed' | 'blocked';
  timestamp: string;
}

export interface AgentKilledEvent {
  taskId: string;
  pid: number;
  timestamp: string;
}

export interface AgentReapedEvent {
  taskId: string;
  merged: boolean;
  taskStatus: string;
  timestamp: string;
}

export interface TaskUpdatedEvent {
  taskId: string;
  field: string;
  oldValue?: string;
  newValue: string;
  timestamp: string;
}

export type EventPayload = {
  'agent:spawned': AgentSpawnedEvent;
  'agent:log': AgentLogEvent;
  'agent:completed': AgentCompletedEvent;
  'agent:killed': AgentKilledEvent;
  'agent:reaped': AgentReapedEvent;
  'task:updated': TaskUpdatedEvent;
};

type EventHandler<T extends EventType> = (payload: EventPayload[T]) => void;

interface Subscription {
  event: EventType;
  handler: EventHandler<any>;
  filter?: string; // Optional filter (e.g., taskId)
}

class EventBus {
  private subscriptions: Subscription[] = [];
  private history: Map<EventType, Array<{ payload: any; timestamp: number }>> = new Map();
  private historyLimit = 100;

  /**
   * Subscribe to an event
   * @param event Event type to subscribe to
   * @param handler Callback function
   * @param filter Optional filter (e.g., taskId to only receive events for that task)
   * @returns Unsubscribe function
   */
  on<T extends EventType>(
    event: T,
    handler: EventHandler<T>,
    filter?: string
  ): () => void {
    const subscription: Subscription = { event, handler, filter };
    this.subscriptions.push(subscription);

    return () => {
      const index = this.subscriptions.indexOf(subscription);
      if (index > -1) {
        this.subscriptions.splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to an event once
   */
  once<T extends EventType>(
    event: T,
    handler: EventHandler<T>,
    filter?: string
  ): () => void {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      handler(payload);
    }, filter);
    return unsubscribe;
  }

  /**
   * Emit an event
   */
  emit<T extends EventType>(event: T, payload: EventPayload[T]): void {
    // Store in history
    if (!this.history.has(event)) {
      this.history.set(event, []);
    }
    const eventHistory = this.history.get(event);
    eventHistory.push({ payload, timestamp: Date.now() });
    if (eventHistory.length > this.historyLimit) {
      eventHistory.shift();
    }

    // Notify subscribers
    for (const sub of this.subscriptions) {
      if (sub.event !== event) continue;

      // Check filter if present
      if (sub.filter) {
        const taskId = (payload as any).taskId;
        if (taskId && taskId !== sub.filter) continue;
      }

      try {
        sub.handler(payload);
      } catch (e) {
        console.error(`EventBus handler error for ${event}:`, e);
      }
    }
  }

  /**
   * Get recent events of a type
   */
  getHistory<T extends EventType>(
    event: T,
    limit?: number
  ): Array<{ payload: EventPayload[T]; timestamp: number }> {
    const eventHistory = this.history.get(event) || [];
    if (limit) {
      return eventHistory.slice(-limit) as any;
    }
    return eventHistory as any;
  }

  /**
   * Clear all subscriptions (for testing)
   */
  clear(): void {
    this.subscriptions = [];
    this.history.clear();
  }

  /**
   * Get subscription count (for debugging)
   */
  getSubscriptionCount(event?: EventType): number {
    if (event) {
      return this.subscriptions.filter(s => s.event === event).length;
    }
    return this.subscriptions.length;
  }
}

// Singleton instance
export const eventBus = new EventBus();

// Convenience functions
export const emit = eventBus.emit.bind(eventBus);
export const on = eventBus.on.bind(eventBus);
export const once = eventBus.once.bind(eventBus);
