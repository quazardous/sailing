/**
 * Structured DAG generation for Vue dashboard
 *
 * Generates node/edge data structures instead of Mermaid code.
 */
import type { PrdData, EpicData, TaskData, StructuredDagResult, DagNode, DagEdge } from './types.js';

/**
 * Generate structured DAG for a PRD
 */
export function generateStructuredPrdDag(prd: PrdData, showTasks: boolean = true, criticalPath?: string[]): StructuredDagResult {
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

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

        // Blocked-by edges (dependency)
        const blockedBy = task.meta?.blocked_by;
        if (blockedBy) {
          const blockers = Array.isArray(blockedBy) ? blockedBy : [blockedBy];
          for (const blocker of blockers) {
            if (blocker && typeof blocker === 'string') {
              edges.push({
                from: blocker,
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
export function generateStructuredEpicDag(
  epic: EpicData,
  parentPrd: { id: string; title: string; status?: string },
  criticalPath?: string[]
): StructuredDagResult {
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

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

    // Blocked-by edges
    const blockedBy = task.meta?.blocked_by;
    if (blockedBy) {
      const blockers = Array.isArray(blockedBy) ? blockedBy : [blockedBy];
      for (const blocker of blockers) {
        if (blocker && typeof blocker === 'string') {
          edges.push({
            from: blocker,
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
export function generateStructuredTaskDag(
  task: TaskData,
  parentEpic: { id: string; title: string; status?: string } | null,
  parentPrd: { id: string; title: string; status?: string } | null
): StructuredDagResult {
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

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
        // Add blocker node at same level
        nodes.push({
          id: blocker,
          type: 'task',
          title: blocker, // Just the ID as title since we don't have full data
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
