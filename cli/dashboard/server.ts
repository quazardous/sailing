/**
 * Sailing Dashboard - Lightweight HTTP server
 * No dependencies, pure Node.js
 *
 * Supports:
 * - HTTP routes (legacy HTMX + API v2 JSON)
 * - WebSocket for real-time updates
 * - Static file serving (legacy views + Vue app)
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleWebSocketUpgrade, closeAll as closeWsConnections } from './websocket.js';
import { startWatchers, stopWatchers } from './watcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;

/**
 * Parse JSON body from a POST request
 */
export async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch { resolve(null); }
    });
    req.on('error', reject);
  });
}

export interface DashboardServerOptions {
  /** Idle timeout in seconds. -1 = infinite, 0 = use default (300s) */
  timeout?: number;
  /** Enable Vue dashboard (serves from dashboard-ui/dist) */
  enableVue?: boolean;
}

export interface DashboardServer {
  start: (callback?: (port: number) => void, onShutdown?: () => void) => void;
  stop: () => void;
  port: number;
  resetTimeout: () => void;
}

const DEFAULT_TIMEOUT = 300; // 5 minutes

export function createServer(
  port: number,
  routes: Record<string, RouteHandler>,
  options: DashboardServerOptions = {}
): DashboardServer {
  const timeoutSeconds = options.timeout === undefined || options.timeout === 0
    ? DEFAULT_TIMEOUT
    : options.timeout;
  const enableVue = options.enableVue ?? true;

  let timeoutTimer: NodeJS.Timeout | null = null;
  let onTimeout: (() => void) | null = null;

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

  const server = http.createServer((req, res) => {
    void (async () => {
      // Reset timeout on each request
      resetTimeout();
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      const pathname = url.pathname;

      // CORS for local dev
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Vue app: serve index.html for root if Vue is enabled and built
      if (enableVue && pathname === '/' && vueDistExists()) {
        return serveVueIndex(res);
      }

      // Vue app assets (if enabled and built)
      if (enableVue && pathname.startsWith('/assets/')) {
        return serveVueAsset(pathname, res);
      }

      // Route matching (exact match first, then pattern match)
      // Routes can be plain pathnames (match any method) or "METHOD pathname" (match specific method)
      const method = req.method || 'GET';

      function matchRoute(routeKey: string): boolean {
        // Check if route has a method prefix (e.g. "POST /api/v2/archive/:id")
        const spaceIdx = routeKey.indexOf(' ');
        if (spaceIdx > 0 && routeKey.substring(0, spaceIdx).match(/^[A-Z]+$/)) {
          const routeMethod = routeKey.substring(0, spaceIdx);
          const routePath = routeKey.substring(spaceIdx + 1);
          if (routeMethod !== method) return false;
          if (routePath.includes(':')) {
            const regex = new RegExp('^' + routePath.replace(/:(\w+)/g, '([^/]+)') + '$');
            return regex.test(pathname);
          }
          return routePath === pathname;
        }
        // No method prefix - match any method
        if (routeKey.includes(':')) {
          const regex = new RegExp('^' + routeKey.replace(/:(\w+)/g, '([^/]+)') + '$');
          return regex.test(pathname);
        }
        return routeKey === pathname;
      }

      // Skip "/" route if Vue is enabled (handled above)
      let handler: RouteHandler | undefined;
      if (!(enableVue && vueDistExists() && pathname === '/')) {
        for (const [routeKey, h] of Object.entries(routes)) {
          if (matchRoute(routeKey)) {
            handler = h;
            break;
          }
        }
      }

      if (handler) {
        try {
          await handler(req, res);
        } catch (err) {
          console.error('Route error:', err);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        }
      } else if (enableVue && vueDistExists() && !pathname.startsWith('/api/')) {
        // Serve Vue app index.html for SPA routes
        return serveVueIndex(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    })();
  });

  // Handle WebSocket upgrade
  server.on('upgrade', (req, socket, _head) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    if (url.pathname === '/ws') {
      // Cast Duplex to Socket - it's a Socket in the upgrade event
      handleWebSocketUpgrade(req, socket as import('net').Socket);
    } else {
      socket.destroy();
    }
  });

  let actualPort = port;

  return {
    start: (callback?: (port: number) => void, onShutdown?: () => void) => {
      onTimeout = () => {
        closeWsConnections();
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
          console.log(`Dashboard: http://127.0.0.1:${actualPort}`);
          if (enableVue && vueDistExists()) {
            console.log(`  Vue app: enabled`);
          }
          console.log(`  WebSocket: ws://127.0.0.1:${actualPort}/ws`);
          // Start file watchers for live reload
          startWatchers();
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
      stopWatchers();
      closeWsConnections();
      server.close();
    },
    resetTimeout,
    get port() {
      return actualPort;
    }
  };
}

// Helper to send HTML response
export function html(res: http.ServerResponse, content: string, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(content);
}

// Helper to send JSON response (no-cache for live updates)
export function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.end(JSON.stringify(data));
}

// Vue app directory (built assets)
function getVueDistDir(): string {
  // Check multiple locations
  const locations = [
    path.resolve(__dirname, '../../dashboard-ui/dist'),  // Installed: .sailing/rudder/../dashboard-ui/dist
    path.resolve(__dirname, '../../../dashboard-ui/dist'),  // Dev: dist/cli/dashboard/../../../dashboard-ui/dist
  ];
  for (const loc of locations) {
    if (fs.existsSync(loc)) return loc;
  }
  return locations[0];  // Default to first location
}

function vueDistExists(): boolean {
  const distDir = getVueDistDir();
  return fs.existsSync(path.join(distDir, 'index.html'));
}

function serveVueIndex(res: http.ServerResponse): void {
  const distDir = getVueDistDir();
  const indexPath = path.join(distDir, 'index.html');

  if (!fs.existsSync(indexPath)) {
    // Vue app not built - show message
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body><h1>Vue Dashboard Not Built</h1><p>Run <code>cd dashboard-ui && npm run build</code> to build the Vue dashboard.</p></body></html>');
    return;
  }

  try {
    const content = fs.readFileSync(indexPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end('Error loading Vue app');
  }
}

function serveVueAsset(pathname: string, res: http.ServerResponse): void {
  const distDir = getVueDistDir();
  const assetPath = path.join(distDir, pathname);

  // Security: prevent directory traversal
  if (!assetPath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(pathname);
  const contentTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  };

  try {
    const content = fs.readFileSync(assetPath);
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000',  // 1 year for hashed assets
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Asset Not Found');
  }
}
