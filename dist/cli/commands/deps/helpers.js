/**
 * Deps command helpers
 *
 * Shared types and utility functions for deps subcommands.
 */
import { normalizeId } from '../../lib/normalize.js';
import { getAllEpics } from '../../managers/artefacts-manager.js';
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Check if ID is an epic (ENNN) vs task (TNNN)
 */
export function isEpicId(id) {
    return /^E\d+$/i.test(id);
}
/**
 * Build epic dependency map
 */
export function buildEpicDependencyMap() {
    const epics = new Map();
    for (const epicEntry of getAllEpics()) {
        const data = epicEntry.data;
        if (!data?.id)
            continue;
        const id = normalizeId(data.id);
        const blockedBy = (data.blocked_by || []).map(b => normalizeId(b));
        epics.set(id, {
            id,
            file: epicEntry.file,
            status: data.status || 'Not Started',
            blockedBy,
            prdId: epicEntry.prdId
        });
    }
    return epics;
}
/**
 * Detect cycles in epic dependencies
 */
export function detectEpicCycles(epics) {
    const cycles = [];
    const visited = new Set();
    const recStack = new Set();
    const dfs = (id, path) => {
        if (recStack.has(id)) {
            const cycleStart = path.indexOf(id);
            cycles.push(path.slice(cycleStart).concat(id));
            return;
        }
        if (visited.has(id))
            return;
        visited.add(id);
        recStack.add(id);
        path.push(id);
        const epic = epics.get(id);
        if (epic) {
            for (const blockerId of epic.blockedBy) {
                dfs(blockerId, [...path]);
            }
        }
        recStack.delete(id);
    };
    for (const id of epics.keys()) {
        if (!visited.has(id)) {
            dfs(id, []);
        }
    }
    return cycles;
}
