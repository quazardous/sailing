import { jsonOut, findProjectRoot } from '../managers/core-manager.js';
import { setProjectRoot as setMcpProjectRoot } from '../managers/mcp-manager.js';
import { addDynamicHelp } from '../lib/help.js';
import { AGENT_TOOLS, handleAgentTool, formatToolHelp, getToolSchema } from '../managers/mcp-tools-manager/index.js';
// Lazy initialization flag
let mcpInitialized = false;
function ensureMcpInit() {
    if (!mcpInitialized) {
        setMcpProjectRoot(findProjectRoot());
        mcpInitialized = true;
    }
}
// =============================================================================
// Helpers
// =============================================================================
/**
 * Parse CLI args into tool arguments
 * Supports: --key=value, --key value, --flag (boolean true)
 */
function parseToolArgs(args) {
    const result = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const withoutDashes = arg.slice(2);
            // Check for --key=value format
            const eqIndex = withoutDashes.indexOf('=');
            if (eqIndex !== -1) {
                const key = withoutDashes.slice(0, eqIndex);
                const value = withoutDashes.slice(eqIndex + 1);
                result[key] = parseValue(value);
            }
            else {
                // Check if next arg is a value or another flag
                const key = withoutDashes;
                const nextArg = args[i + 1];
                if (nextArg && !nextArg.startsWith('--')) {
                    result[key] = parseValue(nextArg);
                    i++; // Skip next arg
                }
                else {
                    // Boolean flag
                    result[key] = true;
                }
            }
        }
    }
    return result;
}
/**
 * Parse a string value to appropriate type
 */
function parseValue(value) {
    // Boolean
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    // Number
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '')
        return num;
    // String (remove quotes if present)
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
/**
 * Format tool schema for display
 */
function formatSchema(toolName) {
    const toolDef = getToolSchema(AGENT_TOOLS, toolName);
    if (!toolDef) {
        return `Tool not found: ${toolName}`;
    }
    const schema = toolDef.tool.inputSchema;
    const props = schema?.properties || {};
    const required = schema?.required || [];
    const lines = [
        `Tool: ${toolDef.tool.name}`,
        `Description: ${toolDef.tool.description}`,
        '',
        'Arguments:'
    ];
    if (Object.keys(props).length === 0) {
        lines.push('  (none)');
    }
    else {
        for (const [name, prop] of Object.entries(props)) {
            const isRequired = required.includes(name);
            const reqStr = isRequired ? ' (required)' : '';
            const typeStr = prop.enum ? prop.enum.join('|') : prop.type;
            lines.push(`  --${name}${reqStr}`);
            lines.push(`      Type: ${typeStr}`);
            if (prop.description) {
                lines.push(`      ${prop.description}`);
            }
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
    lines.push(`  bin/rudder mcp-agent:call ${toolName} ${exampleArgs}`);
    return lines.join('\n');
}
// =============================================================================
// Commands
// =============================================================================
export function registerMcpAgentCommands(program) {
    const mcpAgent = program.command('mcp-agent')
        .description('MCP Agent debug commands (limited sandbox access)');
    // mcp-agent:tools - List all tools
    mcpAgent.command('tools')
        .description('List available MCP agent tools')
        .option('--json', 'JSON output')
        .option('-v, --verbose', 'Show argument details')
        .action((options) => {
        if (options.json) {
            jsonOut({
                type: 'agent',
                description: 'Limited sandbox access - read/log tools only',
                tools: AGENT_TOOLS.map(t => ({
                    name: t.tool.name,
                    description: t.tool.description,
                    schema: t.tool.inputSchema
                })),
                count: AGENT_TOOLS.length
            });
        }
        else {
            console.log('MCP Agent Tools (Limited Sandbox Access)');
            console.log(`Total: ${AGENT_TOOLS.length} tools\n`);
            console.log('NOTE: Sandbox agents have limited access.');
            console.log('      No spawn/kill/create operations available.');
            console.log(formatToolHelp(AGENT_TOOLS, options.verbose));
            console.log('\nUsage: bin/rudder mcp-agent:call <tool> [--args...]');
            console.log('Help:  bin/rudder mcp-agent:schema <tool>');
        }
    });
    // mcp-agent:call - Call a tool
    mcpAgent.command('call <tool>')
        .description('Call an MCP agent tool')
        .option('--json', 'JSON output')
        .allowUnknownOption(true)
        .action(async (tool, options, command) => {
        // Initialize MCP project root (deferred to avoid import hoisting issues)
        ensureMcpInit();
        // Get all args after the tool name
        const rawArgs = command.args.slice(1); // Skip tool name
        const toolArgs = parseToolArgs(rawArgs);
        // Remove the --json flag from args
        delete toolArgs.json;
        const result = await handleAgentTool(tool, toolArgs);
        if (options.json) {
            jsonOut({
                tool,
                args: toolArgs,
                success: !result.isError,
                result: result.content[0]?.text
            });
        }
        else {
            if (result.isError) {
                console.error('Error:', result.content[0]?.text);
                process.exit(1);
            }
            else {
                // Try to pretty print JSON
                const text = result.content[0]?.text || '';
                try {
                    const parsed = JSON.parse(text);
                    console.log(JSON.stringify(parsed, null, 2));
                }
                catch {
                    console.log(text);
                }
            }
        }
    });
    // mcp-agent:schema - Show tool schema
    mcpAgent.command('schema <tool>')
        .description('Show tool schema and usage')
        .option('--json', 'JSON output')
        .action((tool, options) => {
        const toolDef = getToolSchema(AGENT_TOOLS, tool);
        if (!toolDef) {
            if (options.json) {
                jsonOut({ error: `Tool not found: ${tool}` });
            }
            else {
                console.error(`Tool not found: ${tool}`);
                console.log('\nAvailable agent tools:');
                AGENT_TOOLS.forEach(t => console.log(`  ${t.tool.name}`));
            }
            process.exit(1);
        }
        if (options.json) {
            jsonOut({
                name: toolDef.tool.name,
                description: toolDef.tool.description,
                schema: toolDef.tool.inputSchema
            });
        }
        else {
            console.log(formatSchema(tool));
        }
    });
    addDynamicHelp(mcpAgent);
}
