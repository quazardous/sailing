/**
 * Dashboard lib index - re-exports all modules
 *
 * Note: data.ts was removed as it violated architecture CONTRACT.
 * Data fetching is now done directly in api.ts which calls managers.
 */
export * from './types.js';
export * from './cache.js';
export * from './render.js';
export * from './dag.js';
export * from './gantt.js';
export * from './templates.js';
