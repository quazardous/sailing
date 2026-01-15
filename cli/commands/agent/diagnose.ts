/**
 * Agent diagnose commands: analyze-log, log-noise-* management
 */
import fs from 'fs';
import path from 'path';
import { jsonOut, getAgentsDir } from '../../managers/core-manager.js';
import { AgentUtils } from '../../lib/agent-utils.js';
import { normalizeId } from '../../lib/normalize.js';
import { getTaskEpic } from '../../managers/artefacts-manager.js';
import {
  NoiseFilter, LogEvent,
  getDiagnoseOps, printDiagnoseResult
} from '../../managers/diagnose-manager.js';

/**
 * Summarize an event for display (exported for use in monitor.ts)
 */
export function summarizeEvent(event: LogEvent, line: string): string {
  const type = event.type;

  if (event.tool_use_result) {
    const result = event.tool_use_result;
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const output = stderr || stdout;
    const truncated = output.length > 200 ? output.substring(0, 200) + '...' : output;
    return `[tool_result] ${truncated.replace(/\n/g, ' ')}`;
  }

  if (type === 'assistant' && event.message?.content) {
    const content = event.message.content;
    if (Array.isArray(content)) {
      const toolUses = content.filter((c: any) => c.type === 'tool_use');
      if (toolUses.length > 0) {
        const tools = toolUses.map((t: any) => t.name).join(', ');
        return `[assistant] tools: ${tools}`;
      }
      const text = content.find((c: any) => c.type === 'text');
      if (text) {
        const truncated = text.text.length > 100 ? text.text.substring(0, 100) + '...' : text.text;
        return `[assistant] ${truncated.replace(/\n/g, ' ')}`;
      }
    }
  }

  if (type === 'system') {
    if (event.mcp_servers) {
      return `[system] MCP servers initialized`;
    }
    return `[system] ${JSON.stringify(event).substring(0, 100)}...`;
  }

  return `[${type}] ${line.substring(0, 150)}...`;
}

/**
 * Resolve task-or-epic argument to epic ID
 */
function resolveEpicId(taskOrEpic: string | undefined): string | null {
  if (!taskOrEpic || taskOrEpic === 'global') {
    return null;
  }
  const normalized = normalizeId(taskOrEpic);
  if (normalized.startsWith('T')) {
    const taskEpic = getTaskEpic(normalized);
    return taskEpic?.epicId || null;
  } else if (normalized.startsWith('E')) {
    return normalized;
  }
  return null;
}

export function registerDiagnoseCommands(agent) {
  // agent:analyze-log - Analyze agent run for errors/issues
  agent.command('analyze-log <task-id>')
    .description('Analyze agent run log for errors and issues')
    .option('--json', 'JSON output')
    .option('--max-line-len <n>', 'Max error line length', '500')
    .action(async (taskId: string, options: any) => {
      const maxLineLen = parseInt(options.maxLineLen) || 500;
      const normalized = normalizeId(taskId);
      const agentUtils = new AgentUtils(getAgentsDir());
      const agentDir = agentUtils.getAgentDir(normalized);
      const logFile = path.join(agentDir, 'run.jsonlog');

      if (!fs.existsSync(logFile)) {
        if (options.json) {
          jsonOut({ error: 'Log file not found', task_id: normalized });
        } else {
          console.error(`Log file not found: ${logFile}`);
        }
        process.exit(1);
      }

      const taskEpic = getTaskEpic(normalized);
      const epicId = taskEpic?.epicId || null;
      const result = getDiagnoseOps().analyzeLog(logFile, epicId, maxLineLen);

      if (options.json) {
        jsonOut({
          task_id: normalized,
          epic_id: epicId,
          total_events: result.total_events,
          filtered_noise: result.filtered_noise,
          errors: result.errors.length,
          error_samples: result.errors.slice(0, 10)
        });
      } else {
        printDiagnoseResult(normalized, result);
      }
    });

  // agent:log-noise-add-filter - Add noise filter
  agent.command('log-noise-add-filter <id> [task-or-epic]')
    .description('Add noise filter (task ID, epic ID, or "global")')
    .option('--description <text>', 'Filter description')
    .option('--type <type>', 'Event type to match')
    .option('--contains <text>', 'Text to match')
    .option('--pattern <regex>', 'Regex pattern to match')
    .action(async (id: string, taskOrEpic: string | undefined, options: any) => {
      const epicId = resolveEpicId(taskOrEpic);

      if (!options.contains && !options.pattern && !options.type) {
        console.error('At least one of --contains, --pattern, or --type is required');
        process.exit(1);
      }

      const ops = getDiagnoseOps();
      const filters = ops.loadNoiseFilters(epicId);

      if (filters.find(f => f.id === id)) {
        console.error(`Filter "${id}" already exists`);
        process.exit(1);
      }

      const newFilter: NoiseFilter = {
        id,
        description: options.description || id,
        match: {}
      };

      if (options.type) newFilter.match.type = options.type;
      if (options.contains) newFilter.match.contains = options.contains;
      if (options.pattern) newFilter.match.pattern = options.pattern;
      newFilter.learned_at = new Date().toISOString();

      filters.push(newFilter);
      ops.saveNoiseFilters(epicId, filters);

      console.log(`Added filter "${id}" to ${epicId || 'global'}`);
    });

  // agent:log-noise-list-filters - List noise filters
  agent.command('log-noise-list-filters [task-or-epic]')
    .description('List noise filters (accepts task ID, epic ID, or "global")')
    .option('--json', 'JSON output')
    .action(async (taskOrEpic: string | undefined, options: any) => {
      const epicId = resolveEpicId(taskOrEpic);
      const filters = getDiagnoseOps().loadNoiseFilters(epicId);

      if (options.json) {
        jsonOut({ epic_id: epicId || 'global', filters });
      } else {
        console.log(`Noise filters for ${epicId || 'global'}:`);
        if (filters.length === 0) {
          console.log('  (none)');
        } else {
          for (const f of filters) {
            console.log(`  ${f.id}: ${f.description}`);
            if (f.match.type) console.log(`    type: ${f.match.type}`);
            if (f.match.contains) console.log(`    contains: ${f.match.contains}`);
            if (f.match.pattern) console.log(`    pattern: ${f.match.pattern}`);
          }
        }
      }
    });

  // agent:log-noise-rm-filter - Remove noise filter
  agent.command('log-noise-rm-filter <id> [task-or-epic]')
    .description('Remove noise filter (task ID, epic ID, or "global")')
    .action(async (id: string, taskOrEpic: string | undefined) => {
      const epicId = resolveEpicId(taskOrEpic);
      const ops = getDiagnoseOps();
      const filters = ops.loadNoiseFilters(epicId);

      const idx = filters.findIndex(f => f.id === id);
      if (idx === -1) {
        console.error(`Filter "${id}" not found`);
        process.exit(1);
      }

      filters.splice(idx, 1);
      ops.saveNoiseFilters(epicId, filters);

      console.log(`Removed filter "${id}" from ${epicId || 'global'}`);
    });
}
