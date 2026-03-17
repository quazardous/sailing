/**
 * MCP Conductor Debug Commands
 *
 * Debug CLI for testing MCP conductor tools (full orchestrator access).
 *
 * Commands:
 * - mcp-conductor:tools  List available tools
 * - mcp-conductor:call   Call a tool
 * - mcp-conductor:schema Show tool schema
 */
import { Command } from 'commander';
import { jsonOut, findProjectRoot } from '../managers/core-manager.js';
import { setProjectRoot as setMcpProjectRoot } from '../managers/mcp-manager.js';
import { addDynamicHelp } from '../lib/help.js';
import {
  CONDUCTOR_TOOLS,
  handleConductorTool,
  formatToolHelp,
  getToolSchema
} from '../managers/mcp-tools-manager/index.js';

// Lazy initialization flag
let mcpInitialized = false;
function ensureMcpInit() {
  if (!mcpInitialized) {
    setMcpProjectRoot(findProjectRoot());
    mcpInitialized = true;
  }
}

// =============================================================================
// Types
// =============================================================================

/** Shape of a JSON Schema property within a tool's inputSchema */
interface SchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
}

/** Subset of JSON Schema used by MCP tool inputSchema */
interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

/** Primitive CLI argument value */
type CliValue = string | number | boolean;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse a single --key or --key=value token, returning [key, value, skip]
 * where skip indicates whether the next arg was consumed.
 */
function parseArg(withoutDashes: string, nextArg: string | undefined): { key: string; value: CliValue; skip: boolean } {
  const eqIndex = withoutDashes.indexOf('=');
  if (eqIndex !== -1) {
    return {
      key: withoutDashes.slice(0, eqIndex),
      value: parseValue(withoutDashes.slice(eqIndex + 1)),
      skip: false
    };
  }
  if (nextArg && !nextArg.startsWith('--')) {
    return { key: withoutDashes, value: parseValue(nextArg), skip: true };
  }
  return { key: withoutDashes, value: true, skip: false };
}

/**
 * Parse CLI args into tool arguments
 * Supports: --key=value, --key value, --flag (boolean true)
 */
function parseToolArgs(args: string[]): Record<string, CliValue> {
  const result: Record<string, CliValue> = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const parsed = parseArg(arg.slice(2), args[i + 1]);
      result[parsed.key] = parsed.value;
      i += parsed.skip ? 2 : 1;
    } else {
      i++;
    }
  }

  return result;
}

/**
 * Strip surrounding quotes from a string value
 */
function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** Boolean keyword lookup */
const BOOL_MAP: Record<string, CliValue> = { 'true': true, 'false': false };

/**
 * Parse a string value to appropriate type.
 * Returns boolean for "true"/"false", number for numeric strings, string otherwise.
 */
function parseValue(value: string): CliValue {
  const asNum = Number(value);
  const resolved: CliValue = BOOL_MAP[value]
    ?? (!isNaN(asNum) && value.trim() !== '' ? asNum : undefined)
    ?? stripQuotes(value);
  return resolved;
}

/**
 * Format a single schema property as display lines
 */
function formatPropertyLines(name: string, prop: SchemaProperty, required: string[]): string[] {
  const isRequired = required.includes(name);
  const reqStr = isRequired ? ' (required)' : '';
  const typeStr = prop.enum ? prop.enum.join('|') : prop.type;
  const lines = [`  --${name}${reqStr}`, `      Type: ${typeStr}`];
  if (prop.description) {
    lines.push(`      ${prop.description}`);
  }
  return lines;
}

/**
 * Format tool schema for display
 */
function formatSchema(toolName: string): string {
  const toolDef = getToolSchema(CONDUCTOR_TOOLS, toolName);
  if (!toolDef) {
    return `Tool not found: ${toolName}`;
  }

  const schema = toolDef.tool.inputSchema as ToolInputSchema;
  const props: Record<string, SchemaProperty> = schema.properties ?? {};
  const required: string[] = schema.required ?? [];

  const lines: string[] = [
    `Tool: ${toolDef.tool.name}`,
    `Description: ${toolDef.tool.description}`,
    '',
    'Arguments:'
  ];

  if (Object.keys(props).length === 0) {
    lines.push('  (none)');
  } else {
    for (const [name, prop] of Object.entries(props)) {
      lines.push(...formatPropertyLines(name, prop, required));
    }
  }

  lines.push('');
  lines.push('Example:');
  const exampleArgs = Object.entries(props)
    .filter(([name]) => required.includes(name))
    .map(([name, prop]) => {
      const example = prop.type === 'string' ? 'value' : '123';
      return `--${name}=${example}`;
    })
    .join(' ');
  lines.push(`  bin/rudder mcp-conductor:call ${toolName} ${exampleArgs}`);

  return lines.join('\n');
}

// =============================================================================
// Commands
// =============================================================================

export function registerMcpConductorCommands(program: Command) {
  const mcpConductor = program.command('mcp-conductor')
    .description('MCP Conductor debug commands (full orchestrator access)');

  // mcp-conductor:tools - List all tools
  mcpConductor.command('tools')
    .description('List available MCP conductor tools')
    .option('--json', 'JSON output')
    .option('-v, --verbose', 'Show argument details')
    .action((options: { json?: boolean; verbose?: boolean }) => {
      if (options.json) {
        jsonOut({
          type: 'conductor',
          description: 'Full orchestrator access - all tools available',
          tools: CONDUCTOR_TOOLS.map(t => ({
            name: t.tool.name,
            description: t.tool.description,
            schema: t.tool.inputSchema
          })),
          count: CONDUCTOR_TOOLS.length
        });
      } else {
        console.log('MCP Conductor Tools (Full Orchestrator Access)');
        console.log(`Total: ${CONDUCTOR_TOOLS.length} tools\n`);
        console.log(formatToolHelp(CONDUCTOR_TOOLS, options.verbose));
        console.log('\nUsage: bin/rudder mcp-conductor:call <tool> [--args...]');
        console.log('Help:  bin/rudder mcp-conductor:schema <tool>');
      }
    });

  // mcp-conductor:call - Call a tool
  mcpConductor.command('call <tool>')
    .description('Call an MCP conductor tool')
    .option('--json', 'JSON output')
    .allowUnknownOption(true)
    .action(async (tool: string, options: { json?: boolean }, command: Command) => {
      // Initialize MCP project root (deferred to avoid import hoisting issues)
      ensureMcpInit();

      // Get all args after the tool name
      const rawArgs = command.args.slice(1); // Skip tool name
      const toolArgs = parseToolArgs(rawArgs);

      // Remove the --json flag from args
      delete toolArgs.json;

      const result = await handleConductorTool(tool, toolArgs);

      if (options.json) {
        jsonOut({
          tool,
          args: toolArgs,
          success: !result.isError,
          result: result.content[0]?.text
        });
      } else {
        if (result.isError) {
          console.error('Error:', result.content[0]?.text);
          process.exit(1);
        } else {
          // Try to pretty print JSON
          const text = result.content[0]?.text || '';
          try {
            const parsed: unknown = JSON.parse(text);
            console.log(JSON.stringify(parsed, null, 2));
          } catch {
            console.log(text);
          }
        }
      }
    });

  // mcp-conductor:schema - Show tool schema
  mcpConductor.command('schema <tool>')
    .description('Show tool schema and usage')
    .option('--json', 'JSON output')
    .action((tool: string, options: { json?: boolean }) => {
      const toolDef = getToolSchema(CONDUCTOR_TOOLS, tool);

      if (!toolDef) {
        if (options.json) {
          jsonOut({ error: `Tool not found: ${tool}` });
        } else {
          console.error(`Tool not found: ${tool}`);
          console.log('\nAvailable tools:');
          CONDUCTOR_TOOLS.forEach(t => console.log(`  ${t.tool.name}`));
        }
        process.exit(1);
      }

      if (options.json) {
        jsonOut({
          name: toolDef.tool.name,
          description: toolDef.tool.description,
          schema: toolDef.tool.inputSchema
        });
      } else {
        console.log(formatSchema(tool));
      }
    });

  addDynamicHelp(mcpConductor);
}
