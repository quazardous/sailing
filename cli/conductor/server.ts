/**
 * Conductor Server
 *
 * Unified HTTP + WebSocket server for browser-controlled development.
 * Extends dashboard with real-time agent control.
 *
 * Features:
 * - All dashboard routes (PRD, Epic, Task views)
 * - Agent control API (spawn, reap, kill)
 * - WebSocket for real-time events
 * - SSE for log streaming
 */
import http from 'http';
import { URL } from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRoutes, type RoutesOptions } from '../dashboard/routes.js';
import { json } from '../dashboard/server.js';
import { getConductorManager } from '../managers/conductor-manager.js';
import { eventBus, type EventType } from '../lib/event-bus.js';
import { WebSocketHandler } from './websocket-handler.js';
import { errorMessage } from '../lib/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Types
// ============================================================================

export interface ConductorServerOptions extends RoutesOptions {
  /** Idle timeout in seconds. -1 = infinite, 0 = use default (300s) */
  timeout?: number;
  /** Enable WebSocket support (default: true) */
  websocket?: boolean;
}

export interface ConductorServer {
  start: (callback?: (port: number) => void, onShutdown?: () => void) => void;
  stop: () => void;
  port: number;
  resetTimeout: () => void;
  broadcast: (type: string, payload: Record<string, unknown>) => void;
}

type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;

const DEFAULT_TIMEOUT = 300; // 5 minutes

// ============================================================================
// Request Handling
// ============================================================================

function findRouteHandler(pathname: string, routes: Record<string, RouteHandler>): RouteHandler | undefined {
  const exact = routes[pathname];
  if (exact) return exact;

  for (const [pattern, h] of Object.entries(routes)) {
    if (pattern.includes(':')) {
      const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$');
      if (regex.test(pathname)) return h;
    }
  }
  return undefined;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  routes: Record<string, RouteHandler>,
  port: number,
  resetTimeout: () => void
): Promise<void> {
  resetTimeout();
  const url = new URL(req.url || '/', `http://localhost:${port}`);
  const pathname = url.pathname;

  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname.startsWith('/static/')) {
    serveStatic(pathname.replace('/static/', ''), res);
    return;
  }

  const handler = findRouteHandler(pathname, routes);
  if (handler) {
    try {
      await handler(req, res);
    } catch (err: unknown) {
      console.error('Route error:', errorMessage(err));
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
}

// ============================================================================
// Server Factory
// ============================================================================

export function createConductorServer(
  port: number,
  options: ConductorServerOptions = {}
): ConductorServer {
  const timeoutSeconds = options.timeout === undefined || options.timeout === 0
    ? DEFAULT_TIMEOUT
    : options.timeout;
  const enableWebSocket = options.websocket !== false;

  let timeoutTimer: NodeJS.Timeout | null = null;
  let onTimeout: (() => void) | null = null;
  let wsHandler: WebSocketHandler | null = null;

  const resetTimeout = () => {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    if (timeoutSeconds > 0) {
      timeoutTimer = setTimeout(() => {
        console.log(`\nIdle timeout (${timeoutSeconds}s) - shutting down...`);
        if (onTimeout) onTimeout();
      }, timeoutSeconds * 1000);
    }
  };

  // Get base dashboard routes
  const dashboardRoutes = createRoutes(options);

  // Add agent control routes
  const routes: Record<string, RouteHandler> = {
    ...dashboardRoutes,
    ...createAgentRoutes(),
    ...createSystemRoutes()
  };

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, routes, port, resetTimeout);
  });

  // Setup WebSocket on upgrade
  if (enableWebSocket) {
    wsHandler = new WebSocketHandler();

    server.on('upgrade', (req, socket, head) => {
      // Cast Duplex to Socket - the upgrade event always provides a net.Socket
      wsHandler.handleUpgrade(req, socket as import('net').Socket, head);
    });

    // Subscribe to events and broadcast
    setupEventBroadcast(wsHandler);
  }

  let actualPort = port;

  return {
    start: (callback?: (port: number) => void, onShutdown?: () => void) => {
      onTimeout = () => {
        if (wsHandler) wsHandler.close();
        server.close();
        if (onShutdown) onShutdown();
      };

      const tryListen = (p: number) => {
        server.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`Port ${p} busy, trying ${p + 1}...`);
            tryListen(p + 1);
          } else {
            throw err;
          }
        });
        server.listen(p, '127.0.0.1', () => {
          actualPort = p;
          console.log(`Conductor: http://127.0.0.1:${actualPort}`);
          if (enableWebSocket) {
            console.log(`WebSocket: ws://127.0.0.1:${actualPort}`);
          }
          // Start initial timeout
          resetTimeout();
          if (callback) callback(actualPort);
        });
      };
      tryListen(port);
    },
    stop: () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (wsHandler) wsHandler.close();
      server.close();
    },
    resetTimeout,
    broadcast: (type: string, payload: Record<string, unknown>) => {
      if (wsHandler) {
        wsHandler.broadcast({ type, ...payload });
      }
    },
    get port() {
      return actualPort;
    }
  };
}

// ============================================================================
// Agent Control Routes
// ============================================================================

function createAgentRoutes(): Record<string, RouteHandler> {
  const conductor = getConductorManager();

  return {
    // Spawn agent
    '/api/agents/:taskId/spawn': async (req, res) => {
      if (req.method !== 'POST') {
        json(res, { error: 'Method not allowed' }, 405);
        return;
      }

      const taskId = extractParam(req.url);
      const body = await parseBody(req);

      const result = await conductor.spawn(taskId, {
        timeout: body.timeout as number | undefined,
        worktree: body.worktree as boolean | undefined,
        resume: body.resume as boolean | undefined,
        verbose: body.verbose as boolean | undefined
      });

      json(res, result, result.success ? 200 : 400);
    },

    // Reap agent
    '/api/agents/:taskId/reap': async (req, res) => {
      if (req.method !== 'POST') {
        json(res, { error: 'Method not allowed' }, 405);
        return;
      }

      const taskId = extractParam(req.url);
      const body = await parseBody(req);

      const result = await conductor.reap(taskId, {
        wait: body.wait as boolean | undefined,
        timeout: body.timeout as number | undefined
      });

      json(res, result, result.success ? 200 : 400);
    },

    // Kill agent
    '/api/agents/:taskId/kill': async (req, res) => {
      if (req.method !== 'POST') {
        json(res, { error: 'Method not allowed' }, 405);
        return;
      }

      const taskId = extractParam(req.url);
      const result = await conductor.kill(taskId);

      json(res, result, result.success ? 200 : 400);
    },

    // Get agent status
    '/api/agents/:taskId': (req, res) => {
      const taskId = extractParam(req.url);
      const status = conductor.getStatus(taskId);

      if (status) {
        json(res, status);
      } else {
        json(res, { error: 'Agent not found' }, 404);
      }
    },

    // Get agent log
    '/api/agents/:taskId/log': (req, res) => {
      const taskId = extractParam(req.url);
      const url = new URL(req.url || '/', 'http://localhost');
      const tail = parseInt(url.searchParams.get('tail') || '100', 10);

      const lines = conductor.getLog(taskId, { tail });
      json(res, { taskId, lines });
    },

    // Stream agent log (SSE)
    '/api/agents/:taskId/log/stream': (req, res) => {
      const taskId = extractParam(req.url);

      // SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      // Send initial ping
      res.write('event: ping\ndata: connected\n\n');

      // Stream logs
      const stream = conductor.createLogStream(taskId, { follow: true, tail: 50 });
      const iterator = stream[Symbol.asyncIterator]();

      const sendNext = async () => {
        try {
          const iterResult: IteratorResult<unknown, undefined> = await iterator.next();
          const { value, done } = iterResult;
          if (done) {
            res.write('event: close\ndata: stream ended\n\n');
            res.end();
            return;
          }

          res.write(`event: log\ndata: ${JSON.stringify(value)}\n\n`);
          void sendNext();
        } catch {
          res.end();
        }
      };

      void sendNext();

      // Cleanup on close
      req.on('close', () => {
        void iterator.return?.();
      });
    },

    // List all agents
    '/api/agents': (req, res) => {
      const agents = conductor.getAllAgents();
      json(res, { agents });
    }
  };
}

// ============================================================================
// System Routes
// ============================================================================

function createSystemRoutes(): Record<string, RouteHandler> {
  return {
    // System status
    '/api/system/status': (req, res) => {
      const conductor = getConductorManager();
      const agents = conductor.getAllAgents();
      const running = Object.values(agents).filter(a => a.status === 'running' || a.status === 'spawned').length;

      json(res, {
        status: 'ok',
        agents: {
          total: Object.keys(agents).length,
          running
        }
      });
    },

    // Health check
    '/api/health': (req, res) => {
      json(res, { status: 'ok', timestamp: new Date().toISOString() });
    }
  };
}

// ============================================================================
// Event Broadcasting
// ============================================================================

function setupEventBroadcast(wsHandler: WebSocketHandler) {
  const events: EventType[] = [
    'agent:spawned',
    'agent:log',
    'agent:completed',
    'agent:killed',
    'agent:reaped',
    'task:updated'
  ];

  for (const event of events) {
    eventBus.on(event, (payload) => {
      wsHandler.broadcast({
        type: event,
        ...payload
      });
    });
  }
}

// ============================================================================
// Helpers
// ============================================================================

function extractParam(url: string | undefined): string {
  // Simple extraction for /api/agents/:taskId pattern
  const parts = (url ?? '').split('/');
  // Find 'agents' and get next segment
  const agentsIdx = parts.findIndex(p => p === 'agents');
  if (agentsIdx >= 0 && parts[agentsIdx + 1]) {
    // Remove query string if present
    return parts[agentsIdx + 1].split('?')[0];
  }
  return '';
}

async function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) as Record<string, unknown> : {});
      } catch {
        resolve({});
      }
    });
  });
}

// Find views directory
function getViewsDir(): string {
  const distViews = path.join(__dirname, '../dashboard/views');
  if (fs.existsSync(distViews)) return distViews;
  const srcViews = path.resolve(__dirname, '../../cli/dashboard/views');
  if (fs.existsSync(srcViews)) return srcViews;
  return distViews;
}

function serveStatic(filename: string, res: http.ServerResponse) {
  const viewsDir = getViewsDir();
  const filePath = path.join(viewsDir, filename);

  // Security: prevent directory traversal
  if (!filePath.startsWith(viewsDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filename);
  const contentTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml'
  };

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}
