const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { gzipSync, brotliCompressSync, deflateSync } = require('node:zlib');
const { OFFLINE_ROBOTO_PATH, withOfflineRoboto } = require('../out/offlineFonts.js');
const { startPreviewProxy } = require('../out/previewProxy.js');

const fontUrl = 'http://127.0.0.1:5000' + OFFLINE_ROBOTO_PATH;
const customFamily = {
  family: 'App Display',
  fonts: [{ asset: 'fonts/display-semibold.ttf', weight: 600, style: 'normal' }]
};
const appRoboto = '{\n  "family": "Roboto", "fonts": [{"asset": "fonts/my-roboto.ttf", "weight": 500}]\n}';

function robotoFamily(manifest) {
  const families = manifest.filter(family => family.family === 'Roboto');
  assert.equal(families.length, 1, 'Exactly one Roboto family must be available');
  assert.ok(families[0].fonts.length > 0);
  return families[0];
}

async function listen(handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

function request(url, { method = 'GET', headers = {}, rawPath } = {}) {
  return new Promise((resolve, reject) => {
    const options = { method, headers };
    if (rawPath !== undefined) options.path = rawPath;
    const req = http.request(url, options, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Request timed out: ' + url)));
    req.end();
  });
}

const json = response => JSON.parse(response.body.toString('utf8'));

test('offline Roboto manifest handling', async t => {
  await t.test('adds a local default font to an empty manifest', () => {
    const manifest = JSON.parse(withOfflineRoboto('[]', fontUrl));
    assert.equal(manifest.length, 1);
    assert.equal(robotoFamily(manifest).fonts[0].asset, fontUrl);
  });

  await t.test('preserves custom font assets and descriptors while adding the fallback', () => {
    const manifest = JSON.parse(withOfflineRoboto(JSON.stringify([customFamily]), fontUrl));
    assert.deepEqual(manifest[0], customFamily);
    assert.equal(manifest.length, 2);
    assert.equal(robotoFamily(manifest).fonts[0].asset, fontUrl);
  });

  await t.test('does not replace or duplicate the app own Roboto family', () => {
    const original = '[\n' + appRoboto + ', ' + JSON.stringify(customFamily) + '\n]';
    assert.equal(withOfflineRoboto(original, fontUrl), original);
  });

  await t.test('preserves invalid or non-array manifests for the normal Flutter error', () => {
    for (const original of ['', '<html>error</html>', '[invalid', '{}', 'null', 'true', '42', '"text"']) {
      assert.equal(withOfflineRoboto(original, fontUrl), original);
    }
  });
});

test('offline fonts are served through the preview without external services', async t => {
  const upstreamRequests = [];
  const manifestBody = Buffer.from(JSON.stringify([customFamily]));
  const ownRobotoBody = Buffer.from('[\n' + appRoboto + '\n]');
  const upstream = await listen((req, res) => {
    upstreamRequests.push(req.url);
    const pathname = new URL(req.url, 'http://fixture').pathname;
    if (pathname === '/empty/assets/FontManifest.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': 2 });
      res.end('[]');
      return;
    }
    if (pathname === '/own/assets/FontManifest.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': ownRobotoBody.length });
      res.end(ownRobotoBody);
      return;
    }
    if (pathname === '/private/assets/FontManifest.json') {
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="fixture"' });
      res.end('{"error":"authentication required"}');
      return;
    }
    if (pathname === '/invalid/assets/FontManifest.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{invalid');
      return;
    }
    const encodings = {
      '/gzip/assets/FontManifest.json': ['gzip', gzipSync],
      '/br/assets/FontManifest.json': ['br', brotliCompressSync],
      '/deflate/assets/FontManifest.json': ['deflate', deflateSync]
    };
    const encoding = encodings[pathname];
    if (pathname === '/assets/FontManifest.json' || encoding) {
      const body = encoding ? encoding[1](manifestBody) : manifestBody;
      const headers = {
        'content-type': 'application/json',
        'content-length': body.length,
        etag: '"upstream-manifest"',
        'cache-control': 'public, max-age=3600'
      };
      if (encoding) headers['content-encoding'] = encoding[0];
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain', 'x-upstream-missing': 'yes' });
    res.end('Fixture resource missing');
  });
  t.after(() => upstream.close());
  // The font fix must also work when the user disables the REST bridge.
  const proxy = await startPreviewProxy(upstream.url, 'iphone15', { enableRestProxy: false });
  t.after(() => proxy.dispose());
  let localFontUrl;

  await t.test('adds Roboto to an empty upstream manifest', async () => {
    const response = await request(proxy.url + '/empty/assets/FontManifest.json');
    assert.equal(response.status, 200);
    const manifest = json(response);
    assert.equal(manifest.length, 1);
    localFontUrl = robotoFamily(manifest).fonts[0].asset;
    const parsed = new URL(localFontUrl);
    assert.equal(parsed.origin, proxy.url, 'The font must use the local preview origin');
  });

  await t.test('retains app fonts and handles query strings and nested asset paths', async () => {
    const response = await request(proxy.url + '/assets/FontManifest.json?v=2');
    assert.equal(response.status, 200);
    const manifest = json(response);
    assert.deepEqual(manifest[0], customFamily);
    assert.equal(robotoFamily(manifest).fonts[0].asset, localFontUrl);
    assert.equal(response.headers.etag, undefined, 'The rewritten body must not use the old ETag');
    assert.match(response.headers['cache-control'], /no-store/);
  });

  await t.test('uses the bundled font bytes without requesting the upstream server', async () => {
    const expected = fs.readFileSync(path.join(__dirname, '../resources/fonts/roboto-regular.ttf'));
    const requestCount = upstreamRequests.length;
    const response = await request(localFontUrl);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, expected);
    assert.ok(response.body.length > 1000, 'The route must serve a real font, not a placeholder');
    assert.match(response.headers['content-type'], /font\/ttf|application\/octet-stream/);
    assert.equal(Number(response.headers['content-length']), expected.length);
    assert.equal(upstreamRequests.length, requestCount);
  });

  await t.test('HEAD provides font metadata without sending a body', async () => {
    const expectedLength = fs.statSync(path.join(__dirname, '../resources/fonts/roboto-regular.ttf')).size;
    const requestCount = upstreamRequests.length;
    const response = await request(localFontUrl, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(response.body.length, 0);
    assert.equal(Number(response.headers['content-length']), expectedLength);
    assert.equal(upstreamRequests.length, requestCount);
  });

  await t.test('rejects writes to the bundled font resource', async () => {
    const requestCount = upstreamRequests.length;
    const response = await request(localFontUrl, { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(upstreamRequests.length, requestCount);
  });

  await t.test('synthesizes a manifest when Flutter returns 404', async () => {
    const response = await request(proxy.url + '/missing/assets/FontManifest.json');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /application\/json/);
    assert.equal(robotoFamily(json(response)).fonts[0].asset, localFontUrl);
  });

  await t.test('preserves the app supplied Roboto instead of replacing its typography', async () => {
    const response = await request(proxy.url + '/own/assets/FontManifest.json');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, ownRobotoBody);
  });

  for (const encoding of ['gzip', 'br', 'deflate']) {
    await t.test('rewrites ' + encoding + ' manifests with consistent response headers', async () => {
      const response = await request(proxy.url + '/' + encoding + '/assets/FontManifest.json');
      assert.equal(response.status, 200);
      assert.equal(response.headers['content-encoding'], undefined);
      assert.equal(response.headers.etag, undefined);
      if (response.headers['content-length'] !== undefined) {
        assert.equal(Number(response.headers['content-length']), response.body.length);
      }
      const manifest = json(response);
      assert.deepEqual(manifest[0], customFamily);
      assert.equal(robotoFamily(manifest).fonts[0].asset, localFontUrl);
    });
  }

  await t.test('does not hide upstream authentication failures', async () => {
    const response = await request(proxy.url + '/private/assets/FontManifest.json');
    assert.equal(response.status, 401);
    assert.equal(response.body.toString('utf8'), '{"error":"authentication required"}');
    assert.equal(response.headers['www-authenticate'], 'Bearer realm="fixture"');
  });

  await t.test('preserves malformed JSON instead of silently replacing the app manifest', async () => {
    const response = await request(proxy.url + '/invalid/assets/FontManifest.json');
    assert.equal(response.status, 200);
    assert.equal(response.body.toString('utf8'), '{invalid');
  });

  await t.test('font routes cannot read arbitrary files or invented font paths', async () => {
    const fontPath = new URL(localFontUrl).pathname;
    const prefix = fontPath.slice(0, fontPath.lastIndexOf('/') + 1);
    for (const rawPath of [
      prefix + 'missing.ttf',
      prefix + '%2e%2e%2fpackage.json',
      prefix + '%2e%2e%5cpackage.json',
      prefix + 'roboto-regular.ttf%2f..%2fpackage.json'
    ]) {
      const response = await request(proxy.url, { rawPath });
      assert.equal(response.status, 404, rawPath);
      assert.ok(!response.body.includes(Buffer.from('"publisher"')), 'Must not leak package.json');
    }
  });

  await t.test('leaves unrelated missing resources missing', async () => {
    const response = await request(proxy.url + '/assets/another-file.json');
    assert.equal(response.status, 404);
    assert.equal(response.body.toString('utf8'), 'Fixture resource missing');
  });
});
