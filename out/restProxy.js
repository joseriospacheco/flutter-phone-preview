"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.proxyRestRequest = proxyRestRequest;
const http = require("http");
const https = require("https");
const hopByHopHeaders = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade'
]);
function cleanHeaders(headers) {
    const excluded = new Set(hopByHopHeaders);
    for (const name of String(headers.connection || '').split(','))
        excluded.add(name.trim().toLowerCase());
    return Object.fromEntries(Object.entries(headers).filter(([name]) => !excluded.has(name.toLowerCase())));
}
function destination(value, base) {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('La API debe usar HTTP o HTTPS sin credenciales en la URL.');
    }
    url.hash = '';
    return url;
}
// The browser only talks to its preview origin. Node performs the REST request
// without changing browser security settings or the user's Flutter source.
function proxyRestRequest(req, res, requestUrl, previewOrigin) {
    const fail = (status, message) => {
        if (res.destroyed || res.writableEnded)
            return;
        if (res.headersSent) {
            res.destroy();
            return;
        }
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(message);
    };
    // Do not expose an open cross-site proxy to arbitrary websites. The route is
    // also unguessable per session; allow clients without Origin for same-origin GET.
    if (req.headers.host !== new URL(previewOrigin).host ||
        (req.headers.origin && req.headers.origin !== previewOrigin) ||
        (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
        fail(403, 'Solo la app de esta vista previa puede usar el proxy REST.');
        return;
    }
    let url;
    try {
        const value = requestUrl.searchParams.get('url');
        if (!value)
            throw new Error('Falta la URL de la API.');
        url = destination(value);
        if (url.origin === previewOrigin)
            throw new Error('La API no puede apuntar al proxy de vista previa.');
    }
    catch {
        fail(400, 'URL de API inválida: usa una URL absoluta HTTP o HTTPS.');
        return;
    }
    const headers = cleanHeaders(req.headers);
    for (const name of Object.keys(headers)) {
        if (['host', 'cookie', 'cookie2', 'origin', 'referer'].includes(name) || name.startsWith('sec-') || name.startsWith('access-control-')) {
            delete headers[name];
        }
    }
    // Incoming transfer framing has been decoded by Node. Re-create chunked
    // framing for streamed bodies, including DELETE/OPTIONS where Node otherwise
    // assumes there is no body when Content-Length is absent.
    if (req.headers['transfer-encoding'] && headers['content-length'] === undefined) {
        headers['transfer-encoding'] = 'chunked';
    }
    const redirectMode = requestUrl.searchParams.get('redirect') || 'follow';
    const pendingRequests = new Set();
    const pendingResponses = new Set();
    let activeRequest;
    let activeResponse;
    let closed = false;
    const timer = setTimeout(() => {
        fail(504, 'La API no respondió en 120 segundos.');
        activeRequest?.destroy();
        activeResponse?.destroy();
    }, 120000);
    const cleanup = () => {
        closed = true;
        clearTimeout(timer);
        for (const request of pendingRequests)
            request.destroy();
        for (const response of pendingResponses)
            response.destroy();
    };
    res.once('close', cleanup);
    req.once('aborted', cleanup);
    // Large uploads are streamed. Keep at most 8 MiB for redirects which must
    // replay a body; never retry a request automatically after a network error.
    const chunks = [];
    let bodySize = 0;
    let replayable = true;
    let bodyEnded = req.readableEnded;
    req.on('data', (chunk) => {
        bodySize += chunk.length;
        if (bodySize <= 8 * 1024 * 1024 && replayable)
            chunks.push(Buffer.from(chunk));
        else {
            replayable = false;
            chunks.length = 0;
        }
    });
    req.once('end', () => { bodyEnded = true; });
    req.once('error', () => { fail(502, 'La solicitud REST se interrumpió.'); cleanup(); });
    const send = (target, method, outgoing, redirects, body) => {
        if (closed || res.writableEnded)
            return;
        if (target.origin === previewOrigin) {
            fail(400, 'La API no puede redirigir al proxy de vista previa.');
            return;
        }
        if (body !== undefined) {
            outgoing = { ...outgoing };
            delete outgoing['transfer-encoding'];
            if (body.length || outgoing['content-length'] !== undefined)
                outgoing['content-length'] = body.length;
        }
        const transport = target.protocol === 'https:' ? https : http;
        let current;
        try {
            current = transport.request(target, { method, headers: outgoing }, response => {
                activeResponse = response;
                pendingResponses.add(response);
                response.once('close', () => pendingResponses.delete(response));
                response.on('error', () => { if (activeResponse === response && activeRequest === current)
                    fail(502, 'La respuesta de la API se interrumpió.'); });
                const status = response.statusCode || 502;
                const location = response.headers.location;
                if ([301, 302, 303, 307, 308].includes(status) && location && redirectMode === 'follow') {
                    if (redirects >= 10) {
                        response.resume();
                        fail(502, 'La API excedió el límite de redirecciones.');
                        return;
                    }
                    let next;
                    try {
                        next = destination(location, target);
                    }
                    catch {
                        response.resume();
                        fail(502, 'La API devolvió una redirección inválida.');
                        return;
                    }
                    const nextHeaders = { ...outgoing };
                    if (next.origin !== target.origin)
                        delete nextHeaders.authorization;
                    const dropBody = (status === 303 && method !== 'HEAD') || ([301, 302].includes(status) && method === 'POST');
                    if (dropBody) {
                        for (const name of ['content-length', 'content-type', 'content-encoding', 'content-language', 'content-location'])
                            delete nextHeaders[name];
                    }
                    response.resume();
                    // A server may redirect before the upload finishes. Wait for its
                    // original body before replaying a 307/308 request.
                    const follow = () => {
                        if (!dropBody && body === undefined && !replayable) {
                            fail(502, 'No se puede reenviar una carga mayor a 8 MiB tras una redirección.');
                            return;
                        }
                        send(next, dropBody ? 'GET' : method, nextHeaders, redirects + 1, dropBody ? Buffer.alloc(0) : (body ?? Buffer.concat(chunks)));
                    };
                    if (bodyEnded)
                        follow();
                    else
                        req.once('end', follow);
                    return;
                }
                const responseHeaders = cleanHeaders(response.headers);
                // Browser cookies belong to the local preview, not to the API host.
                // Do not let upstream cookies or policies change that local origin.
                for (const name of Object.keys(responseHeaders)) {
                    if (name.startsWith('access-control-') || ['set-cookie', 'set-cookie2', 'clear-site-data',
                        'content-security-policy', 'content-security-policy-report-only', 'strict-transport-security'].includes(name))
                        delete responseHeaders[name];
                }
                responseHeaders['cache-control'] = 'no-store';
                responseHeaders['x-phone-preview-response-url'] = target.href;
                responseHeaders['x-phone-preview-redirected'] = redirects > 0 ? 'true' : 'false';
                res.writeHead(status, responseHeaders);
                response.on('error', () => res.destroy());
                response.pipe(res);
            });
        }
        catch {
            fail(502, 'No se pudo preparar la solicitud a la API.');
            return;
        }
        activeRequest = current;
        pendingRequests.add(current);
        current.once('close', () => pendingRequests.delete(current));
        current.once('error', () => {
            if (activeRequest === current)
                fail(502, 'No se pudo conectar con la API. Verifica la URL, la red y el certificado HTTPS.');
        });
        if (body !== undefined)
            current.end(body);
        else
            req.pipe(current);
    };
    send(url, req.method || 'GET', headers, 0);
}
//# sourceMappingURL=restProxy.js.map