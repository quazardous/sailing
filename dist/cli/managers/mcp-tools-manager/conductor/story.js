/**
 * MCP Conductor Tools - Story operations
 */
import { getOrphanStories, validateStories } from '../../../operations/story-ops.js';
import { ok, canonicalId } from '../types.js';
export const STORY_TOOLS = [
    {
        tool: {
            name: 'story_orphans',
            description: 'List orphan stories (not referenced by any task)',
            inputSchema: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: 'Filter by PRD (PRD-001)' }
                }
            }
        },
        handler: (args) => {
            const result = getOrphanStories({ prd: args.scope });
            const nextActions = [];
            const orphans = result.orphans.map(o => ({ ...o, id: canonicalId(o.id) }));
            if (orphans.length > 0) {
                nextActions.push({
                    tool: 'artefact_show',
                    args: { id: orphans[0].id },
                    reason: `Review first orphan story: ${orphans[0].id}`,
                    priority: 'normal'
                });
            }
            return ok({
                success: true,
                data: { ...result, orphans },
                next_actions: nextActions
            });
        }
    },
    {
        tool: {
            name: 'story_validate',
            description: 'Validate stories (check for orphans and invalid references)',
            inputSchema: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: 'Filter by PRD (PRD-001)' }
                }
            }
        },
        handler: (args) => {
            const result = validateStories({ prd: args.scope });
            const nextActions = [];
            const issues = result.issues.map(i => ({ ...i, storyId: canonicalId(i.storyId) }));
            if (!result.valid && issues.length > 0) {
                const orphanIssues = issues.filter(i => i.type === 'orphan');
                if (orphanIssues.length > 0) {
                    nextActions.push({
                        tool: 'story_orphans',
                        args: { scope: args.scope },
                        reason: `${orphanIssues.length} orphan stories need linking`,
                        priority: 'high'
                    });
                }
            }
            return ok({
                success: true,
                data: { ...result, issues },
                next_actions: nextActions
            });
        }
    }
];
