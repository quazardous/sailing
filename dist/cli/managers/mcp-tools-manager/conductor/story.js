/**
 * MCP Conductor Tools - Story operations
 */
import { getOrphanStories, validateStories } from '../../../operations/story-ops.js';
import { ok } from '../types.js';
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
            if (result.orphans.length > 0) {
                nextActions.push({
                    tool: 'artefact_show',
                    args: { id: result.orphans[0].id },
                    reason: `Review first orphan story: ${result.orphans[0].id}`,
                    priority: 'normal'
                });
            }
            return ok({
                success: true,
                data: result,
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
            if (!result.valid && result.issues.length > 0) {
                const orphanIssues = result.issues.filter(i => i.type === 'orphan');
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
                data: result,
                next_actions: nextActions
            });
        }
    }
];
