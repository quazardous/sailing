/**
 * Diagnose command - Filter and simplify agent run logs
 */
import fs from 'fs';
import path from 'path';
import { jsonOut } from '../lib/core.js';
import { getAgentDir } from '../lib/agent-utils.js';
import { normalizeId } from '../lib/normalize.js';
import { addDynamicHelp } from '../lib/help.js';
import { getTaskEpic } from '../lib/index.js';
import {
  NoiseFilter, LogEvent,
  loadNoiseFilters, saveNoiseFilters, matchesNoiseFilter,
  parseJsonLog, truncateError, analyzeLog, printDiagnoseResult
} from '../lib/diagnose.js';

/**
 * Summarize an event for display
 */
function summarizeEvent(event: LogEvent, line: string): string {
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

export function registerDiagnoseCommands(program: any): void {
  const diagnose = program
    .command('diagnose')
    .description('Analyze agent run logs');

  addDynamicHelp(diagnose);

  // diagnose:run - Show filtered log
  diagnose.command('run <task-id>')
    .description('Show filtered log for agent run')
    .option('--json', 'JSON output')
    .option('--raw', 'Show raw events (no filtering)')
    .option('--limit <n>', 'Limit output lines', '50')
    .action(async (taskId: string, options: any) => {
      const normalized = normalizeId(taskId);
      const agentDir = getAgentDir(normalized);
      const logFile = path.join(agentDir, 'run.jsonlog');

      if (!fs.existsSync(logFile)) {
        console.error(`Log file not found: ${logFile}`);
        process.exit(1);
      }

      const taskEpic = getTaskEpic(normalized);
      const epicId = taskEpic?.epicId || null;
      const noiseFilters = options.raw ? [] : loadNoiseFilters(epicId);
      const { events, lines } = parseJsonLog(logFile);

      const limit = parseInt(options.limit) || 50;
      const output: any[] = [];
      let filtered = 0;

      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const line = lines[i];

        let isNoise = false;
        for (const filter of noiseFilters) {
          if (matchesNoiseFilter(line, event, filter)) {
            isNoise = true;
            filtered++;
            break;
          }
        }

        if (isNoise) continue;

        if (output.length < limit) {
          if (options.json) {
            output.push({ line: i + 1, type: event.type, event });
          } else {
            output.push({ line: i + 1, summary: summarizeEvent(event, line) });
          }
        }
      }

      if (options.json) {
        jsonOut({
          task_id: normalized,
          epic_id: epicId,
          total: events.length,
          filtered,
          shown: output.length,
          events: output
        });
      } else {
        console.log(`Task: ${normalized} | Epic: ${epicId || 'unknown'}`);
        console.log(`Events: ${events.length} total, ${filtered} filtered, showing ${output.length}`);
        console.log('---');
        for (const o of output) {
          console.log(`${o.line}: ${o.summary}`);
        }
      }
    });

  // diagnose:post-run - Simplified output for agent analysis
  diagnose.command('post-run <task-id>')
    .description('Output filtered log for post-run analysis')
    .option('--json', 'JSON output')
    .option('--max-line-len <n>', 'Max error line length', '500')
    .action(async (taskId: string, options: any) => {
      const maxLineLen = parseInt(options.maxLineLen) || 500;
      const normalized = normalizeId(taskId);
      const agentDir = getAgentDir(normalized);
      const logFile = path.join(agentDir, 'run.jsonlog');

      if (!fs.existsSync(logFile)) {
        if (options.json) {
          jsonOut({ error: 'Log file not found', task_id: normalized });
        }
        return;
      }

      const taskEpic = getTaskEpic(normalized);
      const epicId = taskEpic?.epicId || null;
      const result = analyzeLog(logFile, epicId, maxLineLen);

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

  // diagnose:add-filter - Add noise filter
  diagnose.command('add-filter <id> [task-or-epic]')
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

      const filters = loadNoiseFilters(epicId);

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
      saveNoiseFilters(epicId, filters);

      console.log(`Added filter "${id}" to ${epicId || 'global'}`);
    });

  // diagnose:filters - List noise filters
  diagnose.command('filters [task-or-epic]')
    .description('List noise filters (accepts task ID, epic ID, or "global")')
    .option('--json', 'JSON output')
    .action(async (taskOrEpic: string | undefined, options: any) => {
      const epicId = resolveEpicId(taskOrEpic);
      const filters = loadNoiseFilters(epicId);

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

  // diagnose:rm-filter - Remove noise filter
  diagnose.command('rm-filter <id> [task-or-epic]')
    .description('Remove noise filter (task ID, epic ID, or "global")')
    .action(async (id: string, taskOrEpic: string | undefined) => {
      const epicId = resolveEpicId(taskOrEpic);
      const filters = loadNoiseFilters(epicId);

      const idx = filters.findIndex(f => f.id === id);
      if (idx === -1) {
        console.error(`Filter "${id}" not found`);
        process.exit(1);
      }

      filters.splice(idx, 1);
      saveNoiseFilters(epicId, filters);

      console.log(`Removed filter "${id}" from ${epicId || 'global'}`);
    });
}
