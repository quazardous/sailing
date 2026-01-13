/**
 * Sailing Dashboard - Lightweight HTTP server
 * No dependencies, pure Node.js
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;

export interface DashboardServer {
  start: (callback?: (port: number) => void) => void;
  stop: () => void;
  port: number;
}

export function createServer(port: number, routes: Record<string, RouteHandler>): DashboardServer {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = url.pathname;

    // CORS for local dev
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Static files
    if (pathname.startsWith('/static/')) {
      return serveStatic(pathname.replace('/static/', ''), res);
    }

    // Route matching (exact match first, then pattern match)
    let handler = routes[pathname];

    // Try pattern matching for dynamic routes like /api/prd/:id
    if (!handler) {
      for (const [pattern, h] of Object.entries(routes)) {
        if (pattern.includes(':')) {
          const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$');
          if (regex.test(pathname)) {
            handler = h;
            break;
          }
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
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  let actualPort = port;

  return {
    start: (callback?: (port: number) => void) => {
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
          if (callback) callback(actualPort);
        });
      };
      tryListen(port);
    },
    stop: () => {
      server.close();
    },
    get port() {
      return actualPort;
    }
  };
}

// Find views directory (works in both dev and dist)
function getViewsDir(): string {
  const distViews = path.join(__dirname, 'views');
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

// Helper to send HTML response
export function html(res: http.ServerResponse, content: string, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(content);
}

// Helper to send JSON response
export function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
