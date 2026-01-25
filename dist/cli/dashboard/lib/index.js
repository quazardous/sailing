/**
 * Dashboard lib index - re-exports all modules
 *
 * Note: data.ts was removed as it violated architecture CONTRACT.
 * Data fetching is now done directly in api.ts which calls managers.
 *
 * Legacy HTMX files removed:
 * - templates.ts (HTMX templates)
 * - render.ts (HTMX rendering helpers)
 * - dag.ts (Mermaid generation)
 */
export * from './types.js';
export * from './cache.js';
export * from './dag-structured.js';
export * from './gantt.js';
