import { log, logDebug } from '../mcp-manager.js';
// Re-export helpers
export { ok, err, fromRunResult, detectType, normalizeId } from './types.js';
// Import tool sets
import { AGENT_TOOLS } from './agent-tools.js';
import { ARTEFACT_TOOLS } from './conductor/artefact.js';
import { WORKFLOW_TOOLS } from './conductor/workflow.js';
import { AGENT_CONDUCTOR_TOOLS } from './conductor/agent.js';
import { MEMORY_TOOLS } from './conductor/memory.js';
import { DEPS_TOOLS } from './conductor/deps.js';
import { STORY_TOOLS } from './conductor/story.js';
import { ADR_TOOLS } from './conductor/adr.js';
import { SYSTEM_TOOLS, setConductorToolsRef } from './conductor/system.js';
import { err } from './types.js';
// Re-export AGENT_TOOLS
export { AGENT_TOOLS };
// Combine all conductor tools
export const CONDUCTOR_TOOLS = [
    ...ARTEFACT_TOOLS,
    ...WORKFLOW_TOOLS,
    ...AGENT_CONDUCTOR_TOOLS,
    ...MEMORY_TOOLS,
    ...DEPS_TOOLS,
    ...STORY_TOOLS,
    ...ADR_TOOLS,
    ...SYSTEM_TOOLS
];
// Set reference for system_help tool
setConductorToolsRef(CONDUCTOR_TOOLS);
// =============================================================================
// Tool Lookup
// =============================================================================
const agentToolMap = new Map(AGENT_TOOLS.map(t => [t.tool.name, t]));
const conductorToolMap = new Map(CONDUCTOR_TOOLS.map(t => [t.tool.name, t]));
export function getAgentTools() {
    return AGENT_TOOLS.map(t => t.tool);
}
export function getConductorTools() {
    return CONDUCTOR_TOOLS.map(t => t.tool);
}
export async function handleAgentTool(name, args) {
    const toolDef = agentToolMap.get(name);
    if (!toolDef) {
        return err(`Unknown agent tool: ${name}`);
    }
    try {
        log('INFO', `Agent tool: ${name}`, args);
        return await toolDef.handler(args);
    }
    catch (error) {
        log('ERROR', `Agent tool failed: ${name}`, { error: error.message });
        return err(error.message);
    }
}
export async function handleConductorTool(name, args) {
    const toolDef = conductorToolMap.get(name);
    if (!toolDef) {
        return err(`Unknown conductor tool: ${name}`);
    }
    try {
        log('INFO', `Conductor tool: ${name}`, args);
        logDebug(`Calling handler for: ${name}`, { args });
        const result = await toolDef.handler(args);
        logDebug(`Handler result for: ${name}`, { result: JSON.stringify(result).substring(0, 500) });
        return result;
    }
    catch (error) {
        log('ERROR', `Conductor tool failed: ${name}`, { error: error.message });
        return err(error.message);
    }
}
// =============================================================================
// Help Formatting (for CLI debug)
// =============================================================================
export function formatToolHelp(tools, verbose = false) {
    const lines = [];
    const byCategory = {};
    for (const t of tools) {
        const [cat] = t.tool.name.split('_');
        if (!byCategory[cat])
            byCategory[cat] = [];
        byCategory[cat].push(t);
    }
    for (const [cat, catTools] of Object.entries(byCategory)) {
        lines.push(`\n${cat.toUpperCase()}`);
        for (const t of catTools) {
            const schema = t.tool.inputSchema;
            const props = schema?.properties || {};
            const required = schema?.required || [];
            const argParts = [];
            for (const [name] of Object.entries(props)) {
                const isRequired = required.includes(name);
                argParts.push(`--${name}${isRequired ? '*' : ''}`);
            }
            lines.push(`  ${t.tool.name.padEnd(20)} ${t.tool.description}`);
            if (argParts.length > 0) {
                lines.push(`  ${''.padEnd(20)} ${argParts.join(' ')}`);
            }
            if (verbose) {
                for (const [name, prop] of Object.entries(props)) {
                    const isRequired = required.includes(name);
                    lines.push(`    --${name}${isRequired ? ' (required)' : ''}: ${prop.description || prop.type}`);
                }
            }
        }
    }
    return lines.join('\n');
}
export function getToolSchema(tools, toolName) {
    return tools.find(t => t.tool.name === toolName);
}
