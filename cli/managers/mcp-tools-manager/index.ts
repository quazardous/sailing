/**
 * MCP Tools Manager - AI-optimized tools for orchestration
 *
 * Design principles:
 * - Generic tools (artefact_* works on any type via ID detection)
 * - Every response includes next_actions suggestions
 * - No CLI passthrough - MCP is complete and self-sufficient
 * - Atomic operations with rich context
 *
 * Two tool sets:
 * - AGENT_TOOLS: Limited tools for sandbox agents
 * - CONDUCTOR_TOOLS: Full tools for orchestrator
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { log, logDebug } from '../mcp-manager.js';

// Re-export types
export type {
  NextAction,
  McpResult,
  ToolResponse,
  ToolHandler,
  ToolDefinition,
  ArtefactType
} from './types.js';

// Re-export helpers
export {
  ok,
  err,
  fromRunResult,
  detectType,
  normalizeId
} from './types.js';

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

import type { ToolDefinition, ToolResponse } from './types.js';
import { err } from './types.js';

// Re-export AGENT_TOOLS
export { AGENT_TOOLS };

// Combine all conductor tools
export const CONDUCTOR_TOOLS: ToolDefinition[] = [
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

export function getAgentTools(): Tool[] {
  return AGENT_TOOLS.map(t => t.tool);
}

export function getConductorTools(): Tool[] {
  return CONDUCTOR_TOOLS.map(t => t.tool);
}

export async function handleAgentTool(name: string, args: Record<string, any>): Promise<ToolResponse> {
  const toolDef = agentToolMap.get(name);
  if (!toolDef) {
    return err(`Unknown agent tool: ${name}`);
  }
  try {
    log('INFO', `Agent tool: ${name}`, args);
    return await toolDef.handler(args);
  } catch (error: any) {
    log('ERROR', `Agent tool failed: ${name}`, { error: error.message });
    return err(error.message);
  }
}

export async function handleConductorTool(name: string, args: Record<string, any>): Promise<ToolResponse> {
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
  } catch (error: any) {
    log('ERROR', `Conductor tool failed: ${name}`, { error: error.message });
    return err(error.message);
  }
}

// =============================================================================
// Help Formatting (for CLI debug)
// =============================================================================

export function formatToolHelp(tools: ToolDefinition[], verbose = false): string {
  const lines: string[] = [];
  const byCategory: Record<string, ToolDefinition[]> = {};

  for (const t of tools) {
    const [cat] = t.tool.name.split('_');
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(t);
  }

  for (const [cat, catTools] of Object.entries(byCategory)) {
    lines.push(`\n${cat.toUpperCase()}`);
    for (const t of catTools) {
      const schema = t.tool.inputSchema as any;
      const props = schema?.properties || {};
      const required = schema?.required || [];

      const argParts: string[] = [];
      for (const [name] of Object.entries(props)) {
        const isRequired = required.includes(name);
        argParts.push(`--${name}${isRequired ? '*' : ''}`);
      }

      lines.push(`  ${t.tool.name.padEnd(20)} ${t.tool.description}`);
      if (argParts.length > 0) {
        lines.push(`  ${''.padEnd(20)} ${argParts.join(' ')}`);
      }

      if (verbose) {
        for (const [name, prop] of Object.entries(props) as [string, any][]) {
          const isRequired = required.includes(name);
          lines.push(`    --${name}${isRequired ? ' (required)' : ''}: ${prop.description || prop.type}`);
        }
      }
    }
  }

  return lines.join('\n');
}

export function getToolSchema(tools: ToolDefinition[], toolName: string): ToolDefinition | undefined {
  return tools.find(t => t.tool.name === toolName);
}
