/**
 * MCP Conductor Tools - Artefact operations
 */
import { runRudder } from '../../mcp-manager.js';
import {
  ok,
  err,
  fromRunResult,
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
      let cmd = `${type}:list`;
      if (scope) cmd += ` ${scope}`;
      if (status) cmd += ` --status "${status}"`;
      if (limit) cmd += ` --limit ${limit}`;
      cmd += ' --json';

      const result = runRudder(cmd, { json: false });
      const nextActions: NextAction[] = [];

      if (result.success && type === 'prd') {
        nextActions.push({
          tool: 'artefact_list',
          args: { type: 'epic', scope: 'PRD-001' },
          reason: 'List epics for a specific PRD',
          priority: 'normal'
        });
      }

      return fromRunResult(result, nextActions);
    }
  },
  {
    tool: {
      name: 'artefact_show',
      description: 'Get artefact details with full content',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Artefact ID (T001, E001, PRD-001, S001)' },
          raw: { type: 'boolean', description: 'Include raw markdown body' }
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

      const cmd = args.raw
        ? `${type}:show ${id} --raw`
        : `${type}:show ${id} --json`;

      const result = runRudder(cmd, { json: false });
      const nextActions: NextAction[] = [];

      // Suggest editing empty sections
      if (result.success && !args.raw) {
        try {
          const data = JSON.parse(result.output || '{}');
          if (type === 'epic' && !data.technical_notes) {
            nextActions.push({
              tool: 'artefact_edit',
              args: { id, section: 'Technical Notes', content: '' },
              reason: 'Technical Notes section is empty',
              priority: 'high'
            });
          }
          if (type === 'task' && !data.deliverables) {
            nextActions.push({
              tool: 'artefact_edit',
              args: { id, section: 'Deliverables', content: '' },
              reason: 'Deliverables section is empty',
              priority: 'high'
            });
          }
        } catch { /* ignore parse errors */ }
      }

      return fromRunResult(result, nextActions);
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
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add' }
        },
        required: ['type', 'title']
      }
    },
    handler: (args) => {
      const { type, parent, title, tags } = args;

      // Validate parent requirement
      if ((type === 'task' || type === 'epic' || type === 'story') && !parent) {
        return err(`Parent ID required for ${type} creation`, [{
          tool: 'artefact_list',
          args: { type: type === 'task' ? 'epic' : 'prd' },
          reason: `List available parents for ${type}`,
          priority: 'high'
        }]);
      }

      let cmd = `${type}:create`;
      if (parent) cmd += ` ${parent}`;
      cmd += ` "${title.replace(/"/g, '\\"')}"`;
      if (tags?.length) {
        tags.forEach((t: string) => { cmd += ` --tag ${t}`; });
      }
      cmd += ' --json';

      const result = runRudder(cmd, { json: false });
      const nextActions: NextAction[] = [];

      if (result.success) {
        // Parse created ID from output
        try {
          const data = JSON.parse(result.output || '{}');
          const createdId = data.id || data.taskId || data.epicId || data.prdId;
          if (createdId) {
            nextActions.push({
              tool: 'artefact_edit',
              args: { id: createdId, section: 'Description', content: '' },
              reason: 'Add description to newly created artefact',
              priority: 'high'
            });
            if (type === 'epic') {
              nextActions.push({
                tool: 'artefact_edit',
                args: { id: createdId, section: 'Acceptance Criteria', content: '' },
                reason: 'Define acceptance criteria',
                priority: 'high'
              });
            }
            if (type === 'task') {
              nextActions.push({
                tool: 'artefact_edit',
                args: { id: createdId, section: 'Deliverables', content: '' },
                reason: 'Define deliverables',
                priority: 'high'
              });
            }
          }
        } catch { /* ignore */ }
      }

      return fromRunResult(result, nextActions);
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

      let cmd = `${type}:update ${id}`;
      if (args.status) cmd += ` --status "${args.status}"`;
      if (args.assignee) cmd += ` --assignee "${args.assignee}"`;
      if (args.title) cmd += ` --title "${args.title}"`;
      if (args.effort && type === 'task') cmd += ` --effort ${args.effort}`;
      if (args.priority && type === 'task') cmd += ` --priority ${args.priority}`;
      if (args.set) {
        Object.entries(args.set).forEach(([k, v]) => {
          cmd += ` --set ${k}=${v}`;
        });
      }
      cmd += ' --json';

      return fromRunResult(runRudder(cmd, { json: false }));
    }
  },
  {
    tool: {
      name: 'artefact_edit',
      description: 'Edit artefact body section (no SEARCH/REPLACE needed)',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Artefact ID' },
          section: { type: 'string', description: 'Section name (Description, Deliverables, Acceptance Criteria, Technical Notes, etc.)' },
          content: { type: 'string', description: 'New section content' },
          mode: { type: 'string', enum: ['replace', 'append', 'prepend'], description: 'Edit mode (default: replace)' }
        },
        required: ['id', 'section', 'content']
      }
    },
    handler: (args) => {
      const id = normalizeId(args.id);
      const type = detectType(id);

      if (type === 'unknown') {
        return err(`Cannot detect artefact type from ID: ${id}`);
      }

      const mode = args.mode || 'replace';
      const modeFlag = mode === 'append' ? ' --append' : mode === 'prepend' ? ' --prepend' : '';

      // Use edit command with content
      const result = runRudder(`${type}:edit ${id} --section "${args.section}" --content "${args.content.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"${modeFlag} --json`, { json: false });

      return fromRunResult(result);
    }
  }
];
