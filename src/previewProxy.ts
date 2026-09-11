import * as http from 'http';
import * as net from 'net';
import { randomBytes } from 'crypto';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'zlib';
import { getKeyboardBridge } from './keyboardBridge';
import { getPrefsBridge, PREFS_MAX_VALUE_BYTES } from './prefsBridge';
import { getRestBridge } from './restBridge';
import { getRuntimeBridge } from './runtimeBridge';
import { proxyRestRequest } from './restProxy';

export interface PreviewProxy {
  url: string;
  token: string;
  dispose(): void;
  flushPrefs(): Promise<void>;
}

// Inject only the local preview response. The user's Flutter files are untouched.
export interface PreviewProxyOptions {
  enableRestProxy?: boolean;
  persistPreferences?: boolean;
  initialPrefs?: Record<string, string>;
  onPrefsChanged?: (prefs: Record<string, string>) => Promise<void> | void;
}

export const PREFS_MAX_KEYS = 2000;
const PREFS_SAVE_DEBOUNCE_MS = 500;
const PREFS_MAX_BODY_BYTES = 256 * 1024;

function sanitizePrefs(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length <= PREFS_MAX_VALUE_BYTES) {
      out[key] = value;
    }
    if (Object.keys(out).length >= PREFS_MAX_KEYS) break;
  }
  return out;
}

export async function startPreviewProxy(upstreamUrl: string, device: string, options: PreviewProxyOptions = {}): Promise<PreviewProxy> {
  const upstream = new URL(upstreamUrl);
  const token = randomBytes(24).toString('hex');
  const bridgePath = `/__phone_preview_${token}.js`;
  const restPath = '/__phone_preview_rest_' + token;
  const prefsPath = '/__phone_preview_prefs_' + token;
  const enableRestProxy = options.enableRestProxy !== false;
  const persistPreferences = options.persistPreferences !== false;
  const prefs = sanitizePrefs(options.initialPrefs);
  let prefsDirty = false;
  let prefsTimer: NodeJS.Timeout | undefined;
  let prefsSaveChain: Promise<void> = Promise.resolve();
  const onPrefsChanged = options.onPrefsChanged;
  function savePrefsNow(): Promise<void> {
    if (!prefsDirty || !onPrefsChanged) {
      prefsDirty = false;
      return Promise.resolve();
    }
    prefsDirty = false;
    const snapshot = { ...prefs };
    prefsSaveChain = prefsSaveChain.then(
      () => onPrefsChanged(snapshot),
      () => onPrefsChanged(snapshot)
    ).then(
      () => undefined,
      () => undefined // best-effort: nunca se interrumpe el preview por esto
    );
    return prefsSaveChain;
  }
  function schedulePrefsSave() {
    prefsDirty = true;
    if (prefsTimer || !onPrefsChanged) return;
    prefsTimer = setTimeout(() => {
      prefsTimer = undefined;
      void savePrefsNow();
    }, PREFS_SAVE_DEBOUNCE_MS);
  }
  async function flushPrefs(): Promise<void> {
    if (prefsTimer) {
      clearTimeout(prefsTimer);
      prefsTimer = undefined;
    }
    // Bucle porque pueden llegar POSTs tardíos mientras se guarda.
    for (let i = 0; i < 10; i++) {
      await savePrefsNow();
      await prefsSaveChain;
      if (!prefsDirty) break;
    }
  }
  const sockets = new Set<net.Socket>();
  let proxyOrigin = '';
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (requestUrl.pathname === bridgePath) {
      const selectedDevice = requestUrl.searchParams.get('device') || device;
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(
        (enableRestProxy ? getRestBridge(restPath) : '') + '\n' +
        (persistPreferences ? getPrefsBridge(JSON.stringify(prefs), prefsPath) : '') + '\n' +
        getRuntimeBridge(token) + '\n' +
        getKeyboardBridge(token, selectedDevice)
      );
      return;
    }
    if (requestUrl.pathname.startsWith('/__phone_preview_prefs_')) {
      if (!persistPreferences || requestUrl.pathname !== prefsPath || req.method !== 'POST') {
        res.writeHead(404);
        res.end('Preferencias no disponibles.');
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > PREFS_MAX_BODY_BYTES) {
          aborted = true;
          res.writeHead(413);
          res.end('Cuerpo demasiado grande.');
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('error', () => { if (!res.headersSent) { res.writeHead(400); res.end(); } });
      req.on('end', () => {
        if (aborted) return;
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            op?: unknown; key?: unknown; value?: unknown;
          };
          if (body.op === 'set' && typeof body.key === 'string' && typeof body.value === 'string') {
            if (body.value.length <= PREFS_MAX_VALUE_BYTES &&
                (body.key in prefs || Object.keys(prefs).length < PREFS_MAX_KEYS)) {
              prefs[body.key] = body.value;
              schedulePrefsSave();
            }
          } else if (body.op === 'remove' && typeof body.key === 'string') {
            if (delete prefs[body.key]) schedulePrefsSave();
          } else if (body.op === 'clearAll') {
            for (const key of Object.keys(prefs)) delete prefs[key];
            schedulePrefsSave();
          }
          res.writeHead(204);
          res.end();
        } catch {
          res.writeHead(400);
          res.end('Cuerpo inválido.');
        }
      });
      return;
    }
    if (requestUrl.pathname.startsWith('/__phone_preview_rest_')) {
      if (!enableRestProxy || requestUrl.pathname !== restPath) {
        res.writeHead(404);
        res.end('Proxy REST no disponible.');
        return;
      }
      proxyRestRequest(req, res, requestUrl, proxyOrigin);
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
    flushPrefs,
    dispose() {
      // En apagado el host puede no esperar: se dispara el flush y
      // deactivate() lo espera explícitamente con flushPrefs().
      void flushPrefs();
      server.close();
      for (const socket of sockets) socket.destroy();
    }
  };
}
