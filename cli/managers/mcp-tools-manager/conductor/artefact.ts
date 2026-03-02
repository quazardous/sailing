/**
 * MCP Conductor Tools - Artefact operations
 */
import { logDebug } from '../../mcp-manager.js';
import { getStore } from '../../artefacts-manager.js';
import {
  ok,
  err,
  normalizeId,
  detectType,
  canonicalId
} from '../types.js';
import type { ToolDefinition, NextAction } from '../types.js';

export const ARTEFACT_TOOLS: ToolDefinition[] = [
  {
    tool: {
      name: 'artefact_list',
      description: 'List artefacts by type and filters',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['task', 'epic', 'prd', 'story'], description: 'Artefact type' },
          scope: { type: 'string', description: 'Filter scope (PRD-001 for epics, E001 for tasks)' },
          status: { type: 'string', description: 'Filter by status' },
          milestone: { type: 'string', description: 'Filter by milestone (epics only)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (any match)' },
          limit: { type: 'number', description: 'Limit results' }
        },
        required: ['type']
      }
    },
    handler: (args) => {
      const { type, scope, status, milestone, tags, limit } = args;
      const store = getStore();
      const nextActions: NextAction[] = [];

      try {
        let items: Array<{ id: string; title?: string; status?: string; [key: string]: unknown }> = [];

        if (type === 'task') {
          const opts: { epicId?: string; status?: string; tags?: string[] } = {};
          if (scope) opts.epicId = scope;
          if (status) opts.status = status;
          if (tags) opts.tags = tags;
          items = store.getAllTasks(opts).map(t => ({
            id: canonicalId(t.id),
            title: t.data?.title,
            status: t.data?.status,
            parent: t.data?.parent,
            assignee: t.data?.assignee
          }));
        } else if (type === 'epic') {
          const opts: { status?: string; milestone?: string; tags?: string[] } = {};
          if (status) opts.status = status;
          if (milestone) opts.milestone = milestone;
          if (tags) opts.tags = tags;
          items = store.getAllEpics(opts).map(e => ({
            id: canonicalId(e.id),
            title: e.data?.title,
            status: e.data?.status,
            parent: e.data?.parent,
            milestone: e.data?.milestone
          }));
        } else if (type === 'prd') {
          items = store.getAllPrds().map(p => ({
            id: canonicalId(p.id),
            title: p.data?.title,
            status: p.data?.status
          }));
          if (status) {
            items = items.filter(i => i.status === status);
          }
        } else if (type === 'story') {
          items = store.getAllStories().map(s => ({
            id: canonicalId(s.id),
            title: s.data?.title,
            type: s.data?.type,
            parent: s.data?.parent
          }));
        }

        if (limit && items.length > limit) {
          items = items.slice(0, limit);
        }

        if (type === 'prd') {
          nextActions.push({
            tool: 'artefact_list',
            args: { type: 'epic', scope: 'PRD-001' },
            reason: 'List epics for a specific PRD',
            priority: 'normal'
          });
        }

        return ok({ success: true, data: { items, count: items.length }, next_actions: nextActions });
      } catch (error: any) {
        return err(error.message);
      }
    }
  },
  {
    tool: {
      name: 'artefact_show',
      description: 'Get artefact details. Use "section" to get only one section (saves context). Use "raw: true" for full body.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Artefact ID (T001, E001, PRD-001, S001)' },
          raw: { type: 'boolean', description: 'Include raw markdown body' },
          section: { type: 'string', description: 'Return only this section content (saves context). Implies raw.' }
        },
        required: ['id']
      }
    },
    handler: (args) => {
      const id = normalizeId(args.id);
      const type = detectType(id);
      const nextActions: NextAction[] = [];

      if (type === 'unknown') {
        return err(`Cannot detect artefact type from ID: ${id}`);
      }

      try {
        const store = getStore();
        let entry: { id: string; file: string; data?: Record<string, unknown> } | null = null;

        if (type === 'task') {
          entry = store.getTask(id);
        } else if (type === 'epic') {
          entry = store.getEpic(id);
        } else if (type === 'prd') {
          entry = store.getPrd(id);
        } else if (type === 'story') {
          entry = store.getStory(id);
        }

        if (!entry) {
          return err(`Artefact not found: ${id}`);
        }

        // Normalize to canonical form using project digit config (e.g. T515 → T00515)
        const entryCanonicalId = canonicalId(entry.id);
        const file = store.loadFile(entry.file);
        if (!file) {
          return err(`Could not load file for: ${id}`);
        }

        // Section filter mode — return only one section
        if (args.section) {
          const body = file.body || '';
          const sectionRegex = new RegExp(`^## ${args.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im');
          const match = sectionRegex.exec(body);
          if (!match) {
            return err(`Section not found: ${args.section}`);
          }
          const sectionStart = match.index + match[0].length;
          const nextSectionMatch = /^## /m.exec(body.slice(sectionStart));
          const sectionEnd = nextSectionMatch ? sectionStart + nextSectionMatch.index : body.length;
          const sectionContent = body.slice(sectionStart, sectionEnd).trim();

          return ok({
            success: true,
            data: { ...file.data, id: entryCanonicalId, section: args.section, body: sectionContent }
          });
        }

        const data = {
          ...file.data,
          id: entryCanonicalId,
          ...(args.raw ? { body: file.body } : {})
        };

        // Suggest editing empty sections
        if (type === 'epic' && !file.body?.includes('## Technical Notes')) {
          nextActions.push({
            tool: 'artefact_edit',
            args: { id: entryCanonicalId, section: 'Technical Notes', content: '' },
            reason: 'Technical Notes section is empty',
            priority: 'high'
          });
        }
        if (type === 'task' && !file.body?.includes('## Deliverables')) {
          nextActions.push({
            tool: 'artefact_edit',
            args: { id: entryCanonicalId, section: 'Deliverables', content: '' },
            reason: 'Deliverables section is empty',
            priority: 'high'
          });
        }

        return ok({ success: true, data, next_actions: nextActions });
      } catch (error: any) {
        return err(error.message);
      }
    }
  },
  {
    tool: {
      name: 'artefact_create',
      description: 'Create new artefact (task, epic, prd, story)',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['task', 'epic', 'prd', 'story'], description: 'Artefact type' },
          parent: { type: 'string', description: 'Parent ID (E001 for task, PRD-001 for epic/story)' },
          title: { type: 'string', description: 'Title' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
          created_at: { type: 'string', description: 'ISO date for creation timestamp (default: now)' }
        },
        required: ['type', 'title']
      }
    },
    handler: (args) => {
      const { type, parent, title, tags, created_at } = args;
      const nextActions: NextAction[] = [];

      // Validate parent requirement
      if ((type === 'task' || type === 'epic' || type === 'story') && !parent) {
        return err(`Parent ID required for ${type} creation`, [{
          tool: 'artefact_list',
          args: { type: type === 'task' ? 'epic' : 'prd' },
          reason: `List available parents for ${type}`,
          priority: 'high'
        }]);
      }

      try {
        const store = getStore();
        let result: { id: string; title: string; parent?: string; file?: string; dir?: string };

        if (type === 'task') {
          result = store.createTask(parent, title, { tags, created_at });
        } else if (type === 'epic') {
          result = store.createEpic(parent, title, { tags, created_at });
        } else if (type === 'prd') {
          result = store.createPrd(title, { tags, created_at });
        } else if (type === 'story') {
          result = store.createStory(parent, title, { tags, created_at });
        } else {
          return err(`Unknown artefact type: ${type}`);
        }

        // Suggest next actions
        nextActions.push({
          tool: 'artefact_edit',
          args: { id: result.id, section: 'Description', content: '' },
          reason: 'Add description to newly created artefact',
          priority: 'high'
        });
        if (type === 'epic') {
          nextActions.push({
            tool: 'artefact_edit',
            args: { id: result.id, section: 'Acceptance Criteria', content: '' },
            reason: 'Define acceptance criteria',
            priority: 'high'
          });
        }
        if (type === 'task') {
          nextActions.push({
            tool: 'artefact_edit',
            args: { id: result.id, section: 'Deliverables', content: '' },
            reason: 'Define deliverables',
            priority: 'high'
          });
        }

        return ok({ success: true, data: result, next_actions: nextActions });
      } catch (error: any) {
        return err(error.message);
      }
    }
  },
  {
    tool: {
      name: 'artefact_update',
      description: 'Update artefact frontmatter (status, assignee, etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Artefact ID' },
          status: { type: 'string', description: 'New status' },
          assignee: { type: 'string', description: 'New assignee' },
          title: { type: 'string', description: 'New title' },
          effort: { type: 'string', description: 'Effort estimate (tasks only)' },
          priority: { type: 'string', description: 'Priority (tasks only)' },
          milestone: { type: 'string', description: 'Milestone (epics only)' },
          set: { type: 'object', description: 'Additional frontmatter fields to set' }
        },
        required: ['id']
      }
    },
    handler: (args) => {
      const id = normalizeId(args.id);
      const type = detectType(id);

      if (type === 'unknown') {
        return err(`Cannot detect artefact type from ID: ${id}`);
      }

      try {
        const store = getStore();
        const result = store.updateArtefact(id, {
          status: args.status,
          title: args.title,
          assignee: args.assignee,
          effort: args.effort,
          priority: args.priority,
          milestone: args.milestone,
          set: args.set
        });

        return ok({ success: true, data: result });
      } catch (error: any) {
        return err(error.message);
      }
    }
  },
  {
    tool: {
      name: 'artefact_touch',
      description: 'Touch artefact - stamp updated_at (and backfill created_at) without modifying body. Useful for testing timestamp behavior.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Artefact ID (T001, E001, PRD-001, S001)' }
        },
        required: ['id']
      }
    },
    handler: (args) => {
      const id = normalizeId(args.id);

      try {
        const store = getStore();
        const result = store.touchArtefact(id);
        return ok({ success: true, data: result });
      } catch (error: any) {
        return err(error.message);
      }
    }
  },
  {
    tool: {
      name: 'artefact_edit',
      description: 'Edit artefact body - supports multi-section editing with ## headers, or patch mode with old_string/new_string for surgical edits. Preferred format: "## Section1\\nContent...\\n## Section2 [append]\\nMore content". Patch mode: provide old_string + new_string to replace exact text without rewriting entire sections.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Artefact ID' },
          content: { type: 'string', description: 'Content with ## Section headers (multi-section) OR single section content if "section" param provided. Not required in patch mode.' },
          section: { type: 'string', description: 'Single section name (optional - omit for multi-section mode, or use with patch mode to scope search)' },
          mode: { type: 'string', enum: ['replace', 'append', 'prepend'], description: 'Edit mode (default: replace)' },
          old_string: { type: 'string', description: 'Exact text to find for patch mode (must be unique in scope). Use with new_string.' },
          new_string: { type: 'string', description: 'Replacement text for patch mode. Use with old_string.' },
          regexp: { type: 'boolean', description: 'Treat old_string as a regex pattern (default: false)' }
        },
        required: ['id']
      }
    },
    handler: (args) => {
      const id = normalizeId(args.id);
      const type = detectType(id);

      logDebug(`artefact_edit: id=${id}, type=${type}`, {
        hasSection: !!args.section,
        mode: args.mode || 'replace',
        contentLength: args.content?.length || 0,
        hasPatch: !!(args.old_string && args.new_string)
      });

      if (type === 'unknown') {
        return err(`Cannot detect artefact type from ID: ${id}`);
      }

      const store = getStore();

      // Get artefact to log file path for debugging
      if (type === 'prd') {
        const prd = store.getPrd(id);
        logDebug(`artefact_edit: PRD lookup`, { id, found: !!prd, file: prd?.file, title: prd?.data?.title });
      }

      try {
        // Patch mode: old_string + new_string
        if (args.old_string !== undefined && args.new_string !== undefined) {
          logDebug(`artefact_edit: patch mode`, { section: args.section, regexp: !!args.regexp });
          const result = store.patchArtefact(id, args.old_string, args.new_string, {
            section: args.section,
            regexp: args.regexp
          });
          logDebug(`artefact_edit: patch result`, { result });
          return ok({ success: true, data: result });
        }

        // Content is required for non-patch modes
        if (args.content === undefined) {
          return err('Either "content" or "old_string"+"new_string" must be provided');
        }

        // If section is provided, use single-section mode
        if (args.section) {
          logDebug(`artefact_edit: single-section mode`, { section: args.section });
          const result = store.editArtefactSection(id, args.section, args.content, {
            mode: args.mode || 'replace'
          });
          logDebug(`artefact_edit: result`, { result });
          return ok({ success: true, data: result });
        }

        // Otherwise, use multi-section mode (preferred)
        logDebug(`artefact_edit: multi-section mode`);
        const result = store.editArtefactMultiSection(id, args.content, args.mode || 'replace');
        logDebug(`artefact_edit: result`, { result });
        return ok({ success: true, data: result });
      } catch (error: any) {
        logDebug(`artefact_edit: error`, { error: error.message, stack: error.stack });
        return err(error.message);
      }
    }
  },
  {
    tool: {
      name: 'archive_show',
      description: 'Show an archived artefact by ID. Returns frontmatter + optional body.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Artefact ID (T001, E001, PRD-001)' },
          raw: { type: 'boolean', description: 'Include raw markdown body' },
          section: { type: 'string', description: 'Return only this section (saves context)' }
        },
        required: ['id']
      }
    },
    handler: (args) => {
      try {
        const store = getStore();
        const entry = store.getArchivedArtefact(args.id);
        if (!entry) {
          return err(`Archived artefact not found: ${args.id}`);
        }

        const file = store.loadFile(entry.file);
        if (!file) {
          return err(`Could not load archive file for: ${args.id}`);
        }

        // Section filter mode
        if (args.section) {
          const body = file.body || '';
          const sectionRegex = new RegExp(`^## ${args.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im');
          const match = sectionRegex.exec(body);
          if (!match) {
            return err(`Section not found: ${args.section}`);
          }
          const sectionStart = match.index + match[0].length;
          const nextSectionMatch = /^## /m.exec(body.slice(sectionStart));
          const sectionEnd = nextSectionMatch ? sectionStart + nextSectionMatch.index : body.length;
          const sectionContent = body.slice(sectionStart, sectionEnd).trim();

          return ok({
            success: true,
            data: { id: canonicalId(entry.id), ...file.data, archived: true, prdId: entry.prdId, section: args.section, body: sectionContent }
          });
        }

        const data = {
          id: canonicalId(entry.id),
          ...file.data,
          archived: true,
          prdId: entry.prdId,
          ...(args.raw ? { body: file.body } : {})
        };

        return ok({ success: true, data });
      } catch (error: any) {
        return err(error.message);
      }
    }
  },
  {
    tool: {
      name: 'archive_list',
      description: 'List archived artefacts. Compact output for context efficiency.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['task', 'epic', 'prd'], description: 'Filter by type' },
          prd: { type: 'string', description: 'Filter by PRD (e.g., PRD-013)' },
          status: { type: 'string', description: 'Filter by status' },
          limit: { type: 'number', description: 'Max results (default 50)' }
        }
      }
    },
    handler: (args) => {
      try {
        const store = getStore();
        let entries = store.getAllArchivedArtefacts({
          type: args.type,
          prd: args.prd,
          status: args.status
        });

        const limit = args.limit || 50;
        if (entries.length > limit) {
          entries = entries.slice(0, limit);
        }

        const items = entries.map(e => ({
          id: canonicalId(e.id),
          title: e.title,
          status: e.status,
          type: e.type,
          parent: e.parent,
          prdId: e.prdId
        }));

        return ok({ success: true, data: { items, count: items.length } });
      } catch (error: any) {
        return err(error.message);
      }
    }
  },
  {
    tool: {
      name: 'artefact_search',
      description: 'Full-text search across active + archived artefacts. Supports fuzzy matching, prefix search, and multi-word AND queries with relevance ranking.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (supports fuzzy matching, prefix, multi-word AND)' },
          type: { type: 'string', enum: ['task', 'epic', 'prd', 'story'], description: 'Filter by artefact type' },
          status: { type: 'string', description: 'Filter by status (substring match)' },
          prd: { type: 'string', description: 'Filter by PRD (e.g., PRD-013)' },
          archived: { type: 'boolean', description: 'true = archive only, false = active only, omit = both' },
          limit: { type: 'number', description: 'Max results (default 30)' },
          fuzzy: { type: 'number', description: 'Fuzzy edit-distance ratio 0..1 (default 0 = exact match)' },
          accent_sensitive: { type: 'boolean', description: 'Accent-sensitive post-filter (default false). When true, "geo" won\'t match "Géolocalisation".' },
          snippet: { type: 'boolean', description: 'Include contextual snippets (±2 lines around match). Default false.' }
        },
        required: ['query']
      }
    },
    handler: (args) => {
      try {
        const store = getStore();
        const hits = store.search(args.query, {
          type: args.type,
          status: args.status,
          prd: args.prd,
          archived: args.archived,
          limit: args.limit,
          fuzzy: args.fuzzy,
          accent_sensitive: args.accent_sensitive,
          snippet: args.snippet
        });

        const items = hits.map(h => ({
          id: canonicalId(h.id),
          type: h.type,
          title: h.title,
          status: h.status,
          parent: h.parent,
          prdId: h.prdId,
          archived: h.archived,
          ...(h.snippet ? { snippet: h.snippet } : {})
        }));

        return ok({ success: true, data: { items, count: items.length } });
      } catch (error: any) {
        return err(error.message);
      }
    }
  }
];
