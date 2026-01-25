/**
 * Dashboard routes - API v2 endpoints only
 *
 * Legacy HTMX routes have been removed.
 * Vue dashboard is served directly by the server.
 */
import http from 'http';
import { json } from './server.js';
import { createApiV2Routes } from './api.js';
import { setCacheTTL, clearCache } from './lib/index.js';
import { clearCache as clearArtefactsCache } from '../managers/artefacts/index.js';

// Routes configuration options
export interface RoutesOptions {
  cacheTTL?: number;
}

// Routes
export function createRoutes(options: RoutesOptions = {}) {
  setCacheTTL(options.cacheTTL || 0);
  clearCache();

  const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = {};

  // Add API v2 routes (JSON for Vue dashboard)
  const apiV2Routes = createApiV2Routes();
  Object.assign(routes, apiV2Routes);

  // Refresh cache endpoint (kept for compatibility)
  routes['/api/refresh'] = (_req, res) => {
    clearArtefactsCache(); // Clear managers cache (task/epic/prd indices)
    clearCache();          // Clear dashboard lib cache
    json(res, { status: 'ok', message: 'Cache cleared' });
  };

  return routes;
}
