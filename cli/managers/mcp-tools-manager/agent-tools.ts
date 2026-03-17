/**
 * MCP Agent Tools - Limited tools for sandbox agents
 */
import { errorMessage } from '../../lib/errors.js';
import { getConductorManager } from '../conductor-manager.js';
import { getStore } from '../artefacts-manager.js';
import {
  getAllAdrs,
  getFullAdr,
  getRelevantAdrs,
  normalizeAdrId,
  getAdrDir
} from '../adr-manager.js';
import {
  logTask,
  showArtefact,
  showDeps,
  loadContext,
  showMemory
} from '../../operations/index.js';
import type { LogLevel } from '../memory-manager.js';
import {
  ok,
  err
} from './types.js';
import type { ToolDefinition } from './types.js';

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    tool: {
      name: 'task_log',
      description: 'Log message for task execution',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID (T001)' },
          message: { type: 'string', description: 'Log message' },
          level: { type: 'string', enum: ['info', 'tip', 'warn', 'error', 'critical'], description: 'Log level' },
          file: { type: 'string', description: 'Related file path' },
          command: { type: 'string', description: 'Related command' }
        },
        required: ['task_id', 'message']
      }
    },
    handler: (args) => {
      const { task_id, message, level: rawLevel, file, command } = args as { task_id: string; message: string; level?: string; file?: string; command?: string };
      const level = (rawLevel?.toUpperCase() || 'INFO') as LogLevel;
      const result = logTask(
        task_id,
        message,
        level,
        { file, command }
      );

      return ok({
        success: true,
        data: result
      });
    }
  },
  {
    tool: {
      name: 'artefact_show',
      description: 'Get artefact details (task, epic, prd, story)',
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
      const { id, raw } = args as { id: string; raw?: boolean };
      const result = showArtefact(id, { raw });

      if (!result.exists) {
        return err(`Artefact not found: ${id}`);
      }

      return ok({
        success: true,
        data: result
      });
    }
  },
  {
    tool: {
      name: 'deps_show',
      description: 'Get dependencies for task or epic',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task or Epic ID (T001, E001)' }
        },
        required: ['id']
      }
    },
    handler: (args) => {
      const { id } = args as { id: string };
      const result = showDeps(id);

      if (!result) {
        return err(`Task not found: ${id}`);
      }

      return ok({
        success: true,
        data: result
      });
    }
  },
  {
    tool: {
      name: 'context_load',
      description: 'Load execution context for operation',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string', description: 'Operation name or task ID' },
          role: { type: 'string', enum: ['agent', 'skill'], description: 'Role (default: agent)' }
        },
        required: ['operation']
      }
    },
    handler: (args) => {
      const { operation, role } = args as { operation: string; role?: string };
      const result = loadContext(operation, { role });

      if (!result) {
        return err(`No context defined for operation: ${operation}`);
      }

      return ok({
        success: true,
        data: result
      });
    }
  },
  {
    tool: {
      name: 'memory_read',
      description: 'Read memory hierarchy (project → PRD → epic)',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Scope: PROJECT, PRD-001, E001, or T001' },
          full: { type: 'boolean', description: 'Include all sections (default: agent-relevant only)' }
        },
        required: ['scope']
      }
    },
    handler: (args) => {
      const { scope, full } = args as { scope: string; full?: boolean };
      const result = showMemory(scope, { full });

      if (!result.exists) {
        return ok({
          success: true,
          data: { exists: false, message: `No memory found for: ${scope}` }
        });
      }

      return ok({
        success: true,
        data: result
      });
    }
  },
  {
    tool: {
      name: 'system_status',
      description: 'Get project status overview',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: () => {
      const store = getStore();
      const prds = store.getAllPrds();
      const tasks = store.getAllTasks();
      const conductor = getConductorManager();
      const agentsRecord = conductor.getAllAgents();
      const agentsList = Object.values(agentsRecord);

      const byStatus: Record<string, number> = {};
      tasks.forEach(t => {
        const status = t.data?.status || 'Unknown';
        byStatus[status] = (byStatus[status] || 0) + 1;
      });

      return ok({
        success: true,
        data: {
          prds: prds.length,
          tasks: { total: tasks.length, byStatus },
          agents: {
            total: agentsList.length,
            running: agentsList.filter(a => a.status === 'running' || a.status === 'spawned').length
          }
        }
      });
    }
  },
  // ADR Tools (read-only for agents)
  {
    tool: {
      name: 'adr_list',
      description: 'List Architecture Decision Records (read-only). Returns available_domains and available_tags for filtering.',
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
            description: 'Filter by tags (returns ADRs matching any tag)'
          }
        }
      }
    },
    handler: (args) => {
      const { status, domain, tags } = args as { status?: string; domain?: string; tags?: string[] };
      try {
        const allEntries = getAllAdrs();

        // Collect available domains and tags from all ADRs
        const domainsSet = new Set<string>();
        const tagsSet = new Set<string>();
        for (const e of allEntries) {
          if (e.data.domain) domainsSet.add(e.data.domain);
          for (const t of (e.data.tags || [])) tagsSet.add(t);
        }

        let entries = allEntries;

        if (status) {
          entries = entries.filter(e => e.data.status === status);
        }
        if (domain) {
          entries = entries.filter(e => e.data.domain === domain);
        }
        if (tags && tags.length > 0) {
          entries = entries.filter(e => {
            const adrTags = e.data.tags || [];
            return tags.some(t => adrTags.includes(t));
          });
        }

        const items = entries.map(e => ({
          id: e.id,
          title: e.data.title,
          status: e.data.status,
          domain: e.data.domain,
          tags: e.data.tags,
          introduced_in: e.data.introduced_in
        }));

        return ok({
          success: true,
          data: {
            items,
            count: items.length,
            available_domains: [...domainsSet].sort(),
            available_tags: [...tagsSet].sort(),
            adr_dir: getAdrDir()
          }
        });
      } catch (error) {
        return err(errorMessage(error));
      }
    }
  },
  {
    tool: {
      name: 'adr_show',
      description: 'Get ADR details (read-only)',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ADR ID (e.g., ADR-001, 1)' }
        },
        required: ['id']
      }
    },
    handler: (args) => {
      const { id: rawId } = args as { id: string };
      const id = normalizeAdrId(rawId);

      try {
        const adr = getFullAdr(id);

        if (!adr) {
          return err(`ADR not found: ${id}`);
        }

        return ok({
          success: true,
          data: {
            id: adr.id,
            title: adr.title,
            status: adr.status,
            domain: adr.domain,
            introduced_in: adr.introduced_in,
            context: adr.context,
            decision: adr.decision,
            body: adr.body
          }
        });
      } catch (error) {
        return err(errorMessage(error));
      }
    }
  },
  {
    tool: {
      name: 'adr_context',
      description: 'Get accepted ADRs formatted for implementation context',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID to infer domain/tags (optional, for future use)' },
          domain: { type: 'string', description: 'Filter by domain' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by tags (returns ADRs matching any tag)'
          }
        }
      }
    },
    handler: (args) => {
      const { task_id: _taskId, domain, tags } = args as { task_id?: string; domain?: string; tags?: string[] };
      // TODO: Use task_id to infer domain/tags from task metadata

      try {
        const adrs = getRelevantAdrs({ domain, tags });

        if (adrs.length === 0) {
          return ok({
            success: true,
            data: { count: 0, context: '', message: 'No accepted ADRs found' }
          });
        }

        const lines: string[] = [];
        for (const adr of adrs) {
          lines.push(`### ${adr.id}: ${adr.title}`);
          if (adr.decision) {
            lines.push(`**Decision**: ${adr.decision.split('\n\n')[0]}`);
          }
          lines.push('');
        }

        return ok({
          success: true,
          data: {
            count: adrs.length,
            adrs: adrs.map(a => ({ id: a.id, title: a.title, domain: a.domain })),
            context: lines.join('\n')
          }
        });
      } catch (error) {
        return err(errorMessage(error));
      }
    }
  }
];
