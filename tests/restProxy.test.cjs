const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { startPreviewProxy } = require('../out/previewProxy.js');

const binaryPayload = Buffer.from([0, 255, 128, 13, 10, 42]);

async function listen(handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    server, url: 'http://127.0.0.1:' + server.address().port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    if (body !== undefined && !headers['content-length'] && !headers['transfer-encoding']) {
      headers = { ...headers, 'content-length': String(Buffer.byteLength(body)) };
    }
    const req = http.request(url, { method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({
        status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Request timed out: ' + url)));
    req.end(body);
  });
}

const json = response => JSON.parse(response.body.toString('utf8'));

test('REST preview proxy integration', async t => {
  let secondApiUrl = '';
  async function apiHandler(req, res) {
    const url = new URL(req.url, 'http://fixture');
    const redirects = {
      '/redirect-relative': '/echo?redirected=yes',
      '/redirect-preserve': '/echo?preserved=yes',
      '/redirect-cross-origin': secondApiUrl + '/echo',
      '/redirect-loop': '/redirect-loop'
    };
    if (redirects[url.pathname]) {
      res.writeHead(url.pathname === '/redirect-preserve' ? 307 : 302, { location: redirects[url.pathname] });
      res.end();
      return;
    }
    if (url.pathname === '/binary') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(binaryPayload);
      return;
    }
    if (url.pathname === '/empty') { res.writeHead(204); res.end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const payload = Buffer.from(JSON.stringify({
      method: req.method, url: req.url, headers: req.headers,
      body: body.toString('utf8'), bodyBase64: body.toString('base64')
    }));
    const status = url.pathname.startsWith('/status/') ? Number(url.pathname.slice(8)) : 200;
    const responseHeaders = {
      'content-type': 'application/json', 'content-length': String(payload.length), 'x-api-header': 'visible-to-app'
    };
    if (url.pathname === '/cookies') responseHeaders['set-cookie'] = ['api_session=secret; Path=/; HttpOnly'];
    res.writeHead(status, responseHeaders);
    res.end(req.method === 'HEAD' ? undefined : payload);
  }
  const secondApi = await listen(apiHandler);
  secondApiUrl = secondApi.url;
  const api = await listen(apiHandler);
  const flutter = await listen((req, res) => {
    if (req.url.startsWith('/main.dart.js')) {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end('globalThis.flutterFixtureLoaded = true;');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Flutter fixture</title></head><body><script src="/main.dart.js"></script></body></html>');
  });
  flutter.server.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', data => socket.write(Buffer.concat([Buffer.from('echo:'), data])));
  });
  const proxy = await startPreviewProxy(flutter.url, 'iphone15', { enableRestProxy: true });
  t.after(async () => { proxy.dispose(); await Promise.all([api.close(), secondApi.close(), flutter.close()]); });
  const endpoint = proxy.url + '/__phone_preview_rest_' + proxy.token;
  const restUrl = target => endpoint + '?url=' + encodeURIComponent(target);
  const rest = (path, options = {}) => request(restUrl(api.url + path), {
    ...options, headers: { origin: proxy.url, ...options.headers }
  });

  await t.test('GET forwards query strings to an API with no CORS headers', async () => {
    const response = await rest('/echo?name=Jos%C3%A9&filter=a%2Fb%3Fc&tag=one&tag=two');
    assert.equal(response.status, 200);
    assert.equal(json(response).url, '/echo?name=Jos%C3%A9&filter=a%2Fb%3Fc&tag=one&tag=two');
    assert.equal(response.headers['x-api-header'], 'visible-to-app');
  });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    await t.test(method + ' preserves method, JSON body, and bearer token', async () => {
      const body = JSON.stringify({ name: 'Jos\u00e9', value: 42, method });
      const response = await rest('/echo', {
        method, headers: { 'content-type': 'application/json', authorization: 'Bearer preview-test-token' }, body
      });
      assert.equal(response.status, 200);
      const echoed = json(response);
      assert.equal(echoed.method, method);
      assert.equal(echoed.body, body);
      assert.equal(echoed.headers['content-type'], 'application/json');
      assert.equal(echoed.headers.authorization, 'Bearer preview-test-token');
      assert.equal(echoed.headers.host, new URL(api.url).host);
    });
  }
  for (const method of ['DELETE', 'OPTIONS']) {
    await t.test(method + ' preserves explicitly streamed request bodies', async () => {
      const body = JSON.stringify({ streamed: true, method });
      const response = await rest('/echo', {
        method, headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, body
      });
      assert.equal(response.status, 200);
      assert.equal(json(response).body, body);
    });
  }
  await t.test('multipart boundaries and binary request bodies remain intact', async () => {
    const boundary = 'preview-fixture-boundary';
    const body = Buffer.concat([
      Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="fixture.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'),
      binaryPayload, Buffer.from('\r\n--' + boundary + '--\r\n')
    ]);
    const response = await rest('/echo', {
      method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=' + boundary }, body
    });
    assert.equal(response.status, 200);
    assert.equal(json(response).bodyBase64, body.toString('base64'));
    assert.equal(json(response).headers['content-type'], 'multipart/form-data; boundary=' + boundary);
  });
  await t.test('binary responses, HEAD, and 204 work without injecting content', async () => {
    const binary = await rest('/binary');
    assert.equal(binary.status, 200);
    assert.deepEqual(binary.body, binaryPayload);
    const head = await rest('/echo', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(head.headers['x-api-header'], 'visible-to-app');
    const empty = await rest('/empty');
    assert.equal(empty.status, 204);
    assert.equal(empty.body.length, 0);
  });
  await t.test('API error statuses and response bodies reach the app', async () => {
    for (const status of [401, 422, 500]) {
      const response = await rest('/status/' + status);
      assert.equal(response.status, status);
      assert.equal(json(response).url, '/status/' + status);
    }
  });
  await t.test('local cookies and browser origin/referrer do not leak to APIs', async () => {
    const response = await rest('/cookies', {
      headers: { cookie: 'local_preview_session=private', referer: proxy.url + '/private?token=hidden' }
    });
    assert.equal(response.status, 200);
    const headers = json(response).headers;
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.origin, undefined);
    assert.equal(headers.referer, undefined);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.notEqual(response.headers['access-control-allow-origin'], '*');
  });
  await t.test('relative redirects preserve same-origin authorization', async () => {
    const response = await rest('/redirect-relative', { headers: { authorization: 'Bearer same-origin-token' } });
    assert.equal(response.status, 200);
    assert.equal(json(response).url, '/echo?redirected=yes');
    assert.equal(json(response).headers.authorization, 'Bearer same-origin-token');
  });
  await t.test('307 replays a streamed body and 302 converts POST to GET', async () => {
    const body = JSON.stringify({ preserved: true });
    const preserved = await rest('/redirect-preserve', {
      method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, body
    });
    assert.equal(preserved.status, 200);
    assert.equal(json(preserved).method, 'POST');
    assert.equal(json(preserved).body, body);
    const converted = await rest('/redirect-relative', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body
    });
    assert.equal(converted.status, 200);
    assert.equal(json(converted).method, 'GET');
    assert.equal(json(converted).body, '');
    assert.equal(json(converted).headers['content-type'], undefined);
  });
  await t.test('cross-origin redirects strip authorization', async () => {
    const response = await rest('/redirect-cross-origin', { headers: { authorization: 'Bearer do-not-forward' } });
    assert.equal(response.status, 200);
    assert.equal(json(response).headers.host, new URL(secondApi.url).host);
    assert.equal(json(response).headers.authorization, undefined);
  });
  await t.test('redirect loops fail within a bounded number of hops', async () => {
    const response = await rest('/redirect-loop');
    assert.ok(response.status >= 400 && response.status < 600);
  });
  await t.test('malformed targets and non-HTTP protocols are rejected', async () => {
    for (const target of ['not a URL', 'file:///private/file', 'ftp://127.0.0.1/file', 'data:text/plain,test']) {
      const response = await request(restUrl(target), { headers: { origin: proxy.url } });
      assert.equal(response.status, 400, target);
    }
    assert.equal((await request(endpoint, { headers: { origin: proxy.url } })).status, 400);
  });
  await t.test('a foreign browser origin cannot use the REST proxy', async () => {
    const response = await request(restUrl(api.url + '/echo'), { headers: { origin: 'https://unrelated.example' } });
    assert.equal(response.status, 403);
    assert.notEqual(response.headers['access-control-allow-origin'], '*');
  });
  await t.test('cross-site fetch metadata and spoofed Host are rejected', async () => {
    for (const headers of [
      { 'sec-fetch-site': 'cross-site' },
      { host: 'unrelated.example' }
    ]) {
      const response = await rest('/echo', { headers });
      assert.equal(response.status, 403);
    }
  });
  await t.test('finishing a redirect closes the previous streaming backend response', async t => {
    let markClosed;
    const closed = new Promise(resolve => { markClosed = resolve; });
    const redirectBackend = await listen((_req, res) => {
      res.on('close', markClosed);
      res.writeHead(302, { location: api.url + '/echo?finished=yes' });
      res.write('redirect body remains open');
    });
    t.after(() => redirectBackend.close());
    const final = await request(restUrl(redirectBackend.url), { headers: { origin: proxy.url } });
    assert.equal(final.status, 200);
    assert.equal(json(final).url, '/echo?finished=yes');
    let timer;
    try {
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('The prior redirect connection remained open')), 1000);
        })
      ]);
    } finally { clearTimeout(timer); }
  });
  await t.test('Flutter HTML injects the REST bridge before bootstrap and assets remain unchanged', async () => {
    const response = await request(proxy.url + '/?_previewDevice=pixel8');
    assert.equal(response.status, 200);
    const html = response.body.toString('utf8');
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
    const bridges = scripts.filter(src => src.includes('__phone_preview_'));
    assert.ok(bridges.length > 0);
    assert.ok(html.indexOf(bridges[0]) < html.indexOf('/main.dart.js'));
    const scriptBodies = await Promise.all(bridges.map(src => request(new URL(src, proxy.url))));
    for (const script of scriptBodies) assert.equal(script.status, 200);
    assert.ok(scriptBodies.some(script => script.body.toString('utf8').includes('__phone_preview_rest_')));
    const asset = await request(proxy.url + '/main.dart.js');
    assert.equal(asset.status, 200);
    assert.equal(asset.body.toString('utf8'), 'globalThis.flutterFixtureLoaded = true;');
  });
  await t.test('Flutter development WebSocket upgrade still forwards data', async () => {
    await new Promise((resolve, reject) => {
      const req = http.request(proxy.url + '/development-ws', {
        headers: { connection: 'Upgrade', upgrade: 'websocket', origin: proxy.url }
      });
      const timer = setTimeout(() => req.destroy(new Error('WebSocket forwarding timed out')), 5000);
      req.on('error', error => { clearTimeout(timer); reject(error); });
      req.on('response', response => {
        clearTimeout(timer); response.resume(); reject(new Error('Expected upgrade, received ' + response.statusCode));
      });
      req.on('upgrade', (response, socket, head) => {
        let received = head;
        socket.on('error', error => { clearTimeout(timer); reject(error); });
        socket.on('data', chunk => {
          received = Buffer.concat([received, chunk]);
          if (received.length < Buffer.byteLength('echo:preview-ping')) return;
          clearTimeout(timer); socket.destroy();
          try {
            assert.equal(response.statusCode, 101);
            assert.equal(received.toString('utf8'), 'echo:preview-ping');
            resolve();
          } catch (error) { reject(error); }
        });
        socket.write('preview-ping');
      });
      req.end();
    });
  });
});

