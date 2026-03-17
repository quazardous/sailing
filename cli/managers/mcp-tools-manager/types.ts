/**
 * MCP Tools - Types and helpers
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { RunResult } from '../mcp-manager.js';
import { normalizeId as normalizeIdLib } from '../../lib/normalize.js';
import { getDigitConfig } from '../config-manager.js';

// =============================================================================
// Types
// =============================================================================

export interface NextAction {
  tool: string;
  // next_actions are suggestions for the AI orchestrator — args shape varies per tool and is not known at compile time
  args: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  reason: string;
  priority?: 'high' | 'normal' | 'low';
}

export interface McpResult {
  success: boolean;
  // data is the tool output — varies per tool (object, array, string). Typed by each tool's response, not at protocol level.
  data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  error?: string;
  next_actions?: NextAction[];
}

export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** MCP tool args — typed as Record<string, unknown> at protocol boundary.
 *  Each handler should cast to a typed interface immediately. */
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponse> | ToolResponse;

export interface ToolDefinition {
  tool: Tool;
  handler: ToolHandler;
}

// =============================================================================
// ID Type Detection
// =============================================================================

export type ArtefactType = 'task' | 'epic' | 'prd' | 'story' | 'panic' | 'unknown';

export function detectType(id: string): ArtefactType {
  if (/^T\d+$/i.test(id)) return 'task';
  if (/^E\d+$/i.test(id)) return 'epic';
  if (/^PRD-?\d+$/i.test(id)) return 'prd';
  if (/^S\d+$/i.test(id)) return 'story';
  if (/^P\d+$/i.test(id)) return 'panic';
  return 'unknown';
}

export function normalizeId(id: string): string {
  return id.toUpperCase().replace(/^PRD(\d)/, 'PRD-$1');
}

/** Normalize an ID to canonical form using project digit config */
export function canonicalId(id: string): string {
  return normalizeIdLib(id, getDigitConfig()) ?? id;
}

// =============================================================================
// Response Helpers
// =============================================================================

export function ok(result: McpResult): ToolResponse {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

export function err(message: string, nextActions?: NextAction[]): ToolResponse {
  const result: McpResult = {
    success: false,
    error: message,
    next_actions: nextActions
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: true
  };
}

export function fromRunResult(result: RunResult, nextActions?: NextAction[]): ToolResponse {
  if (result.success) {
    // Try to parse JSON output
    // JSON.parse returns any — we pass it through to McpResult.data which is also any (tool output varies)
    let data: any = result.output || ''; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      data = JSON.parse(result.output || '');
    } catch { /* keep as string */ }

    return ok({
      success: true,
      data,
      next_actions: nextActions
    });
  }
  return err(`${result.error}\n${result.stderr || ''}`, nextActions);
}
