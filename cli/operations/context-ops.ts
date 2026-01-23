/**
 * Context Operations - High-level context operations shared by CLI and MCP
 */
import { composeContext } from '../managers/compose-manager.js';

// ============================================================================
// LOAD CONTEXT
// ============================================================================

export interface LoadContextOptions {
  role?: string;
  debug?: boolean;
}

export interface LoadContextResult {
  operation: string;
  role: string;
  sources: string[];
  content: string;
}

/**
 * Load execution context for an operation
 */
export function loadContext(operation: string, options: LoadContextOptions = {}): LoadContextResult | null {
  const role = options.role || 'agent';

  const result = composeContext({
    operation,
    role,
    debug: options.debug
  });

  if (!result) {
    return null;
  }

  return {
    operation: result.operation,
    role: result.role,
    sources: result.sources,
    content: result.content
  };
}
