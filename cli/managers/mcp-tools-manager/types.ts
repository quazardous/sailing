/**
 * MCP Tools - Types and helpers
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { RunResult } from '../mcp-manager.js';

// =============================================================================
// Types
// =============================================================================

export interface NextAction {
  tool: string;
  args: Record<string, any>;
  reason: string;
  priority?: 'high' | 'normal' | 'low';
}

export interface McpResult {
  success: boolean;
  data?: any;
  error?: string;
  next_actions?: NextAction[];
}

export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, any>) => Promise<ToolResponse> | ToolResponse;

export interface ToolDefinition {
  tool: Tool;
  handler: ToolHandler;
}

// =============================================================================
// ID Type Detection
// =============================================================================

export type ArtefactType = 'task' | 'epic' | 'prd' | 'story' | 'unknown';

export function detectType(id: string): ArtefactType {
  if (/^T\d+$/i.test(id)) return 'task';
  if (/^E\d+$/i.test(id)) return 'epic';
  if (/^PRD-?\d+$/i.test(id)) return 'prd';
  if (/^S\d+$/i.test(id)) return 'story';
  return 'unknown';
}

export function normalizeId(id: string): string {
  return id.toUpperCase().replace(/^PRD(\d)/, 'PRD-$1');
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
    let data: any = result.output || '';
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
