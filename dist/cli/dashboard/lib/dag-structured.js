/**
 * Structured DAG generation for Vue dashboard
 *
 * Generates node/edge data structures instead of Mermaid code.
 */
import { buildIdResolver } from '../../lib/normalize.js';
/**
 * Generate structured DAG for a PRD
 */
export function generateStructuredPrdDag(prd, showTasks = true, criticalPath) {
    const nodes = [];
    const edges = [];
    // Build resolver from all task IDs for robust dependency matching
    const taskIds = [];
    if (showTasks) {
        for (const epic of prd.epics) {
            for (const task of epic.tasks)
                taskIds.push(task.id);
        }
    }
    const resolve = buildIdResolver(taskIds);
    // PRD node (level 0)
    nodes.push({
        id: prd.id,
        type: 'prd',
        title: prd.title,
        status: prd.status,
        level: 0
    });
    for (const epic of prd.epics) {
        // Epic node (level 1)
        nodes.push({
            id: epic.id,
            type: 'epic',
            title: epic.title,
            status: epic.status,
            level: 1
        });
        // PRD -> Epic edge
        edges.push({
            from: prd.id,
            to: epic.id,
            type: 'hierarchy'
        });
        if (showTasks) {
            for (const task of epic.tasks) {
                // Task node (level 2)
                nodes.push({
                    id: task.id,
                    type: 'task',
                    title: task.title,
                    status: task.status,
                    level: 2
                });
                // Epic -> Task edge
                edges.push({
                    from: epic.id,
                    to: task.id,
                    type: 'hierarchy'
                });
                // Blocked-by edges (dependency) — resolve to canonical ID
                const blockedBy = task.meta?.blocked_by;
                if (blockedBy) {
                    const blockers = Array.isArray(blockedBy) ? blockedBy : [blockedBy];
                    for (const blocker of blockers) {
                        if (blocker && typeof blocker === 'string') {
                            edges.push({
                                from: resolve(blocker) ?? blocker,
                                to: task.id,
                                type: 'dependency'
                            });
                        }
                    }
                }
            }
        }
    }
    return { nodes, edges, criticalPath };
}
/**
 * Generate structured DAG for an Epic
 */
export function generateStructuredEpicDag(epic, parentPrd, criticalPath) {
    const nodes = [];
    const edges = [];
    const resolve = buildIdResolver(epic.tasks.map(t => t.id));
    // PRD node (level 0)
    nodes.push({
        id: parentPrd.id,
        type: 'prd',
        title: parentPrd.title,
        status: parentPrd.status || 'Draft',
        level: 0
    });
    // Epic node (level 1)
    nodes.push({
        id: epic.id,
        type: 'epic',
        title: epic.title,
        status: epic.status,
        level: 1
    });
    // PRD -> Epic edge
    edges.push({
        from: parentPrd.id,
        to: epic.id,
        type: 'hierarchy'
    });
    for (const task of epic.tasks) {
        // Task node (level 2)
        nodes.push({
            id: task.id,
            type: 'task',
            title: task.title,
            status: task.status,
            level: 2
        });
        // Epic -> Task edge
        edges.push({
            from: epic.id,
            to: task.id,
            type: 'hierarchy'
        });
        // Blocked-by edges — resolve to canonical ID
        const blockedBy = task.meta?.blocked_by;
        if (blockedBy) {
            const blockers = Array.isArray(blockedBy) ? blockedBy : [blockedBy];
            for (const blocker of blockers) {
                if (blocker && typeof blocker === 'string') {
                    edges.push({
                        from: resolve(blocker) ?? blocker,
                        to: task.id,
                        type: 'dependency'
                    });
                }
            }
        }
    }
    return { nodes, edges, criticalPath };
}
/**
 * Generate structured DAG for a Task
 */
export function generateStructuredTaskDag(task, parentEpic, parentPrd) {
    const nodes = [];
    const edges = [];
    // PRD node (level 0)
    if (parentPrd) {
        nodes.push({
            id: parentPrd.id,
            type: 'prd',
            title: parentPrd.title,
            status: parentPrd.status || 'Draft',
            level: 0
        });
    }
    // Epic node (level 1)
    if (parentEpic) {
        nodes.push({
            id: parentEpic.id,
            type: 'epic',
            title: parentEpic.title,
            status: parentEpic.status || 'Draft',
            level: 1
        });
        if (parentPrd) {
            edges.push({
                from: parentPrd.id,
                to: parentEpic.id,
                type: 'hierarchy'
            });
        }
    }
    // Task node (level 2)
    nodes.push({
        id: task.id,
        type: 'task',
        title: task.title,
        status: task.status,
        level: 2
    });
    if (parentEpic) {
        edges.push({
            from: parentEpic.id,
            to: task.id,
            type: 'hierarchy'
        });
    }
    // Add blocker tasks as separate nodes
    const blockedBy = task.meta?.blocked_by;
    if (blockedBy) {
        const blockers = Array.isArray(blockedBy) ? blockedBy : [blockedBy];
        for (const blocker of blockers) {
            if (blocker && typeof blocker === 'string') {
                // Add blocker node at same level (use raw ID since we don't have full data to resolve)
                nodes.push({
                    id: blocker,
                    type: 'task',
                    title: blocker,
                    status: 'Unknown',
                    level: 2
                });
                edges.push({
                    from: blocker,
                    to: task.id,
                    type: 'dependency'
                });
            }
        }
    }
    return { nodes, edges };
}
