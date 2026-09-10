import * as http from 'http';
import * as net from 'net';
import { randomBytes } from 'crypto';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'zlib';
import { getKeyboardBridge } from './keyboardBridge';

export interface PreviewProxy {
  url: string;
  token: string;
  dispose(): void;
}

// Inject only the local preview response. The user's Flutter files are untouched.
export async function startPreviewProxy(upstreamUrl: string, device: string): Promise<PreviewProxy> {
  const upstream = new URL(upstreamUrl);
  const token = randomBytes(24).toString('hex');
  const bridgePath = `/__phone_preview_${token}.js`;
  const sockets = new Set<net.Socket>();
  let proxyOrigin = '';
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (requestUrl.pathname === bridgePath) {
      const selectedDevice = requestUrl.searchParams.get('device') || device;
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(getKeyboardBridge(token, selectedDevice));
      return;
    }
    const headers = { ...req.headers, host: upstream.host, 'accept-encoding': 'identity' };
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
    if (headers.origin === proxyOrigin) headers.origin = upstream.origin;
    const target = http.request({
      hostname: upstream.hostname, port: upstream.port, method: req.method,
      path: requestUrl.pathname + requestUrl.search, headers
    }, response => {
      const responseHeaders = { ...response.headers };
      if (!String(response.headers['content-type']).includes('text/html') || req.method === 'HEAD') {
        res.writeHead(response.statusCode || 502, responseHeaders);
        response.pipe(res);
        response.on('error', () => res.destroy());
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', () => res.destroy());
      response.on('end', () => {
        try {
          let body = Buffer.concat(chunks);
          const encoding = response.headers['content-encoding'];
          if (encoding === 'gzip') body = gunzipSync(body);
          else if (encoding === 'deflate') body = inflateSync(body);
          else if (encoding === 'br') body = brotliDecompressSync(body);
          const selectedDevice = requestUrl.searchParams.get('_previewDevice') || device;
          const script = `<script src="${bridgePath}?device=${encodeURIComponent(selectedDevice)}"></script>`;
          const html = body.toString('utf8');
          const injected = /<head(?:\s[^>]*)?>/i.test(html)
            ? html.replace(/<head(?:\s[^>]*)?>/i, head => head + script)
            : script + html;
          delete responseHeaders['content-length'];
          delete responseHeaders['content-encoding'];
          delete responseHeaders['etag'];
          responseHeaders['cache-control'] = 'no-store';
          res.writeHead(response.statusCode || 200, responseHeaders);
          res.end(injected);
        } catch {
          res.writeHead(502);
          res.end('No se pudo preparar la vista previa.');
        }
      });
    });
    target.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('El servidor Flutter no está disponible.');
    });
    target.setTimeout(120000, () => target.destroy());
    res.on('close', () => target.destroy());
    req.pipe(target);
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  // Preserve Flutter's development WebSocket connections through the proxy.
  server.on('upgrade', (req, socket, head) => {
    const remote = net.connect(Number(upstream.port) || 80, upstream.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i];
        const value = key.toLowerCase() === 'host' ? upstream.host
          : key.toLowerCase() === 'origin' && req.rawHeaders[i + 1] === proxyOrigin ? upstream.origin : req.rawHeaders[i + 1];
        lines.push(`${key}: ${value}`);
      }
      remote.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length) remote.write(head);
      socket.pipe(remote).pipe(socket);
    });
    sockets.add(remote);
    remote.on('close', () => { sockets.delete(remote); socket.destroy(); });
    remote.on('error', () => socket.destroy());
    socket.on('error', () => remote.destroy());
    socket.on('close', () => remote.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as net.AddressInfo).port;
  proxyOrigin = `http://127.0.0.1:${port}`;
  return {
    url: proxyOrigin, token,
    dispose() { server.close(); for (const socket of sockets) socket.destroy(); }
  };
}
