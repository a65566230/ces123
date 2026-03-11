import { createServer } from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

function contentType(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.map')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

export async function startFixtureServer(fixturesDir: string): Promise<{
  origin: string;
  close(): Promise<void>;
}> {
  const sockets = new Set<import('net').Socket>();
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');

    if (requestUrl.pathname === '/api/sign') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ signature: 'fixture-signature', ok: true }));
      return;
    }

    const relativePath = requestUrl.pathname === '/'
      ? path.join('basic', 'index.html')
      : requestUrl.pathname.replace(/^\/+/, '');
    const filePath = path.join(fixturesDir, relativePath);

    try {
      const file = await readFile(filePath);
      response.writeHead(200, { 'content-type': contentType(filePath) });
      response.end(file);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine fixture server address');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
