/**
 * MCP Conductor Tools - ADR (Architecture Decision Records) operations
 */
import { getAllAdrs, getFullAdr, createAdr, updateAdrStatus, getRelevantAdrs, normalizeAdrId, getAdrDir } from '../../adr-manager.js';
import { ok, err } from '../types.js';
export const ADR_TOOLS = [
    {
        tool: {
            name: 'adr_list',
            description: 'List Architecture Decision Records with optional filters',
            inputSchema: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['Proposed', 'Accepted', 'Deprecated', 'Superseded'],
                        description: 'Filter by status'
                    },
                    domain: { type: 'string', description: 'Filter by domain (e.g., core, api, frontend)' },
                    tags: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Filter by tags'
                    }
                }
            }
        },
        handler: (args) => {
            const nextActions = [];
            try {
                const allEntries = getAllAdrs();
                // Collect available domains and tags from all ADRs
                const domainsSet = new Set();
                const tagsSet = new Set();
                for (const e of allEntries) {
                    if (e.data.domain)
                        domainsSet.add(e.data.domain);
                    for (const t of (e.data.tags || []))
                        tagsSet.add(t);
                }
                let entries = allEntries;
                // Apply filters
                if (args.status) {
                    entries = entries.filter(e => e.data.status === args.status);
                }
                if (args.domain) {
                    entries = entries.filter(e => e.data.domain === args.domain);
                }
                if (args.tags && args.tags.length > 0) {
                    entries = entries.filter(e => {
                        const adrTags = e.data.tags || [];
                        return args.tags.some((t) => adrTags.includes(t));
                    });
                }
                const items = entries.map(e => ({
                    id: e.id,
                    title: e.data.title,
                    status: e.data.status,
                    domain: e.data.domain,
                    tags: e.data.tags,
                    introduced_in: e.data.introduced_in,
                    created: e.data.created
                }));
                if (items.length === 0) {
                    nextActions.push({
                        tool: 'adr_create',
                        args: { title: 'Example Decision' },
                        reason: 'No ADRs found - create one to document architectural decisions',
                        priority: 'normal'
                    });
                }
                return ok({
                    success: true,
                    data: {
                        items,
                        count: items.length,
                        available_domains: [...domainsSet].sort(),
                        available_tags: [...tagsSet].sort(),
                        adr_dir: getAdrDir()
                    },
                    next_actions: nextActions
                });
            }
            catch (error) {
                return err(error.message);
            }
        }
    },
    {
        tool: {
            name: 'adr_show',
            description: 'Get ADR details with full content',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'ADR ID (e.g., ADR-001, 1, or ADR-1)' }
                },
                required: ['id']
            }
        },
        handler: (args) => {
            const id = normalizeAdrId(args.id);
            const nextActions = [];
            try {
                const adr = getFullAdr(id);
                if (!adr) {
                    return err(`ADR not found: ${id}`, [{
                            tool: 'adr_list',
                            args: {},
                            reason: 'List available ADRs',
                            priority: 'high'
                        }]);
                }
                // Suggest accepting if still proposed
                if (adr.status === 'Proposed') {
                    nextActions.push({
                        tool: 'adr_accept',
                        args: { id: adr.id },
                        reason: 'ADR is still Proposed - consider accepting after review',
                        priority: 'normal'
                    });
                }
                return ok({
                    success: true,
                    data: {
                        id: adr.id,
                        title: adr.title,
                        status: adr.status,
                        created: adr.created,
                        author: adr.author,
                        domain: adr.domain,
                        tags: adr.tags,
                        introduced_in: adr.introduced_in,
                        supersedes: adr.supersedes,
                        superseded_by: adr.superseded_by,
                        context: adr.context,
                        decision: adr.decision,
                        body: adr.body,
                        file: adr.filePath
                    },
                    next_actions: nextActions
                });
            }
            catch (error) {
                return err(error.message);
            }
        }
    },
    {
        tool: {
            name: 'adr_create',
            description: 'Create a new Architecture Decision Record',
            inputSchema: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Decision title (e.g., "Layer Architecture")' },
                    author: { type: 'string', description: 'Author name' },
                    domain: { type: 'string', description: 'Domain (e.g., core, api, frontend)' },
                    tags: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Tags for categorization'
                    },
                    introduced_in: { type: 'string', description: 'Component/version when introduced (e.g., "core/1.18.0")' }
                },
                required: ['title']
            }
        },
        handler: (args) => {
            const { title, author, domain, tags, introduced_in } = args;
            const nextActions = [];
            try {
                const result = createAdr(title, {
                    author,
                    domain,
                    tags,
                    introduced_in
                });
                // Suggest editing the new ADR
                nextActions.push({
                    tool: 'adr_show',
                    args: { id: result.id },
                    reason: 'View and edit the newly created ADR',
                    priority: 'high'
                });
                return ok({
                    success: true,
                    data: {
                        id: result.id,
                        file: result.file,
                        message: 'ADR created. Edit the file to fill in Context, Decision, and Consequences.'
                    },
                    next_actions: nextActions
                });
            }
            catch (error) {
                return err(error.message);
            }
        }
    },
    {
        tool: {
            name: 'adr_accept',
            description: 'Mark an ADR as Accepted (active decision)',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'ADR ID' }
                },
                required: ['id']
            }
        },
        handler: (args) => {
            const id = normalizeAdrId(args.id);
            try {
                const success = updateAdrStatus(id, 'Accepted');
                if (!success) {
                    return err(`ADR not found: ${id}`, [{
                            tool: 'adr_list',
                            args: {},
                            reason: 'List available ADRs',
                            priority: 'high'
                        }]);
                }
                return ok({
                    success: true,
                    data: {
                        id,
                        status: 'Accepted',
                        message: 'ADR marked as Accepted - it is now an active architectural decision'
                    }
                });
            }
            catch (error) {
                return err(error.message);
            }
        }
    },
    {
        tool: {
            name: 'adr_deprecate',
            description: 'Mark an ADR as Deprecated or Superseded',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'ADR ID to deprecate' },
                    superseded_by: { type: 'string', description: 'ADR ID that supersedes this one (optional)' }
                },
                required: ['id']
            }
        },
        handler: (args) => {
            const id = normalizeAdrId(args.id);
            const supersededBy = args.superseded_by ? normalizeAdrId(args.superseded_by) : undefined;
            const newStatus = supersededBy ? 'Superseded' : 'Deprecated';
            try {
                const success = updateAdrStatus(id, newStatus, { supersededBy });
                if (!success) {
                    return err(`ADR not found: ${id}`, [{
                            tool: 'adr_list',
                            args: {},
                            reason: 'List available ADRs',
                            priority: 'high'
                        }]);
                }
                return ok({
                    success: true,
                    data: {
                        id,
                        status: newStatus,
                        superseded_by: supersededBy,
                        message: supersededBy
                            ? `ADR marked as Superseded by ${supersededBy}`
                            : 'ADR marked as Deprecated'
                    }
                });
            }
            catch (error) {
                return err(error.message);
            }
        }
    },
    {
        tool: {
            name: 'adr_context',
            description: 'Get accepted ADRs formatted for agent context injection',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID to infer domain/tags (optional, for future use)' },
                    domain: { type: 'string', description: 'Filter by domain' },
                    tags: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Filter by tags'
                    }
                }
            }
        },
        handler: (args) => {
            // TODO: Use task_id to infer domain/tags from task metadata
            const _taskId = args.task_id;
            try {
                const adrs = getRelevantAdrs({
                    domain: args.domain,
                    tags: args.tags
                });
                if (adrs.length === 0) {
                    return ok({
                        success: true,
                        data: {
                            count: 0,
                            context: '',
                            message: 'No accepted ADRs found matching criteria'
                        }
                    });
                }
                // Format for prompt injection
                const lines = ['## Architecture Decision Records (ADRs)', ''];
                for (const adr of adrs) {
                    lines.push(`### ${adr.id}: ${adr.title}`);
                    if (adr.decision) {
                        // Take first paragraph of decision
                        const decisionSummary = adr.decision.split('\n\n')[0];
                        lines.push(`**Decision**: ${decisionSummary}`);
                    }
                    if (adr.context) {
                        // Take first sentence of context
                        const contextSummary = adr.context.split('.')[0] + '.';
                        lines.push(`**Why**: ${contextSummary}`);
                    }
                    lines.push('');
                }
                return ok({
                    success: true,
                    data: {
                        count: adrs.length,
                        adrs: adrs.map(a => ({
                            id: a.id,
                            title: a.title,
                            domain: a.domain,
                            decision_summary: a.decision?.split('\n\n')[0]
                        })),
                        context: lines.join('\n')
                    }
                });
            }
            catch (error) {
                return err(error.message);
            }
        }
    }
];
