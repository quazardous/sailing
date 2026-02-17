/**
 * MCP Conductor Tools - Artefact operations
 */
import { loadFile } from '../../core-manager.js';
import { logDebug } from '../../mcp-manager.js';
import {
  getAllTasks,
  getAllEpics,
  getAllPrds,
  getAllStories,
  getTask,
  getEpic,
  getPrd,
  getStory,
  createTask,
  createEpic,
  createPrd,
  createStory,
  updateArtefact,
  editArtefactSection,
  editArtefactMultiSection,
  patchArtefact
} from '../../artefacts-manager.js';
import {
  ok,
  err,
  normalizeId,
  detectType
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
          limit: { type: 'number', description: 'Limit results' }
        },
        required: ['type']
      }
    },
    handler: (args) => {
      const { type, scope, status, limit } = args;
      const nextActions: NextAction[] = [];

      try {
        let items: Array<{ id: string; title?: string; status?: string; [key: string]: unknown }> = [];

        if (type === 'task') {
          const opts: { epicId?: string; status?: string } = {};
          if (scope) opts.epicId = scope;
          if (status) opts.status = status;
          items = getAllTasks(opts).map(t => ({
            id: t.id,
            title: t.data?.title,
            status: t.data?.status,
            parent: t.data?.parent,
            assignee: t.data?.assignee
          }));
        } else if (type === 'epic') {
          const opts: { status?: string } = {};
          if (status) opts.status = status;
          items = getAllEpics(opts).map(e => ({
            id: e.id,
            title: e.data?.title,
            status: e.data?.status,
            parent: e.data?.parent
          }));
        } else if (type === 'prd') {
          items = getAllPrds().map(p => ({
            id: p.id,
            title: p.data?.title,
            status: p.data?.status
          }));
          if (status) {
            items = items.filter(i => i.status === status);
          }
        } else if (type === 'story') {
          items = getAllStories().map(s => ({
            id: s.id,
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
        let entry: { file: string; data?: Record<string, unknown> } | null = null;

        if (type === 'task') {
          entry = getTask(id);
        } else if (type === 'epic') {
          entry = getEpic(id);
        } else if (type === 'prd') {
          entry = getPrd(id);
        } else if (type === 'story') {
          entry = getStory(id);
        }

        if (!entry) {
          return err(`Artefact not found: ${id}`);
        }

        const file = loadFile(entry.file);
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
          const nextSectionMatch = body.slice(sectionStart).match(/^## /m);
          const sectionEnd = nextSectionMatch ? sectionStart + nextSectionMatch.index : body.length;
          const sectionContent = body.slice(sectionStart, sectionEnd).trim();

          return ok({
            success: true,
            data: { ...file.data, section: args.section, body: sectionContent }
          });
        }

        const data = {
          ...file.data,
          ...(args.raw ? { body: file.body } : {})
        };

        // Suggest editing empty sections
        if (type === 'epic' && !file.body?.includes('## Technical Notes')) {
          nextActions.push({
            tool: 'artefact_edit',
            args: { id, section: 'Technical Notes', content: '' },
            reason: 'Technical Notes section is empty',
            priority: 'high'
          });
        }
        if (type === 'task' && !file.body?.includes('## Deliverables')) {
          nextActions.push({
            tool: 'artefact_edit',
            args: { id, section: 'Deliverables', content: '' },
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
        let result: { id: string; title: string; parent?: string; file?: string; dir?: string };

        if (type === 'task') {
          result = createTask(parent, title, { tags, created_at });
        } else if (type === 'epic') {
          result = createEpic(parent, title, { tags, created_at });
        } else if (type === 'prd') {
          result = createPrd(title, { tags, created_at });
        } else if (type === 'story') {
          result = createStory(parent, title, { tags, created_at });
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
        const result = updateArtefact(id, {
          status: args.status,
          title: args.title,
          assignee: args.assignee,
          effort: args.effort,
          priority: args.priority,
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

      // Get artefact to log file path for debugging
      if (type === 'prd') {
        const prd = getPrd(id);
        logDebug(`artefact_edit: PRD lookup`, { id, found: !!prd, file: prd?.file, title: prd?.data?.title });
      }

      try {
        // Patch mode: old_string + new_string
        if (args.old_string !== undefined && args.new_string !== undefined) {
          logDebug(`artefact_edit: patch mode`, { section: args.section, regexp: !!args.regexp });
          const result = patchArtefact(id, args.old_string, args.new_string, {
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
          const result = editArtefactSection(id, args.section, args.content, {
            mode: args.mode || 'replace'
          });
          logDebug(`artefact_edit: result`, { result });
          return ok({ success: true, data: result });
        }

        // Otherwise, use multi-section mode (preferred)
        logDebug(`artefact_edit: multi-section mode`);
        const result = editArtefactMultiSection(id, args.content, args.mode || 'replace');
        logDebug(`artefact_edit: result`, { result });
        return ok({ success: true, data: result });
      } catch (error: any) {
        logDebug(`artefact_edit: error`, { error: error.message, stack: error.stack });
        return err(error.message);
      }
    }
  }
];
