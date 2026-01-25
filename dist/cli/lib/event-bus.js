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
class EventBus {
    subscriptions = [];
    history = new Map();
    historyLimit = 100;
    /**
     * Subscribe to an event
     * @param event Event type to subscribe to
     * @param handler Callback function
     * @param filter Optional filter (e.g., taskId to only receive events for that task)
     * @returns Unsubscribe function
     */
    on(event, handler, filter) {
        const subscription = { event, handler, filter };
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
    once(event, handler, filter) {
        const unsubscribe = this.on(event, (payload) => {
            unsubscribe();
            handler(payload);
        }, filter);
        return unsubscribe;
    }
    /**
     * Emit an event
     */
    emit(event, payload) {
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
            if (sub.event !== event)
                continue;
            // Check filter if present
            if (sub.filter) {
                const taskId = payload.taskId;
                if (taskId && taskId !== sub.filter)
                    continue;
            }
            try {
                sub.handler(payload);
            }
            catch (e) {
                console.error(`EventBus handler error for ${event}:`, e);
            }
        }
    }
    /**
     * Get recent events of a type
     */
    getHistory(event, limit) {
        const eventHistory = this.history.get(event) || [];
        if (limit) {
            return eventHistory.slice(-limit);
        }
        return eventHistory;
    }
    /**
     * Clear all subscriptions (for testing)
     */
    clear() {
        this.subscriptions = [];
        this.history.clear();
    }
    /**
     * Get subscription count (for debugging)
     */
    getSubscriptionCount(event) {
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
