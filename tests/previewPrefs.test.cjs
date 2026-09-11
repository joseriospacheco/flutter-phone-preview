const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { startPreviewProxy } = require('../out/previewProxy.js');

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}) }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function setup(options = {}) {
  const snapshots = [];
  const proxy = await startPreviewProxy('http://127.0.0.1:9/', 'iphone15', {
    persistPreferences: true,
    initialPrefs: { seeded: '1' },
    onPrefsChanged: async (prefs) => { snapshots.push(prefs); },
    ...options
  });
  const port = new URL(proxy.url).port;
  const prefsPath = `/__phone_preview_prefs_${proxy.token}`;
  const bridgePath = `/__phone_preview_${proxy.token}.js`;
  return { proxy, port, prefsPath, bridgePath, snapshots };
}

test('seeded prefs are embedded in the injected bridge', async (t) => {
  const { proxy, port, bridgePath } = await setup();
  t.after(() => proxy.dispose());
  const res = await request(port, 'GET', bridgePath);
  assert.equal(res.status, 200);
  // La semilla viaja escapada dentro de JSON.parse("{\"seeded\":\"1\"}").
  assert.match(res.body, /phone_preview_prefs_/);
  assert.match(res.body, /seeded/);
});

test('writes are stored and flushed with the final snapshot', async (t) => {
  const { proxy, port, prefsPath, snapshots } = await setup();
  t.after(() => proxy.dispose());
  for (const [key, value] of [['a', '1'], ['b', '2'], ['c', '3']]) {
    const res = await request(port, 'POST', prefsPath, JSON.stringify({ op: 'set', key, value }));
    assert.equal(res.status, 204);
  }
  await proxy.flushPrefs();
  assert.ok(snapshots.length >= 1);
  const last = snapshots[snapshots.length - 1];
  assert.equal(last.a, '1');
  assert.equal(last.b, '2');
  assert.equal(last.c, '3');
  assert.equal(last.seeded, '1');
});

test('remove and clearAll update the snapshot', async (t) => {
  const { proxy, port, prefsPath, snapshots } = await setup();
  t.after(() => proxy.dispose());
  await request(port, 'POST', prefsPath, JSON.stringify({ op: 'set', key: 'temp', value: 'x' }));
  await request(port, 'POST', prefsPath, JSON.stringify({ op: 'remove', key: 'temp' }));
  await proxy.flushPrefs();
  assert.ok(!('temp' in snapshots[snapshots.length - 1]));
  await request(port, 'POST', prefsPath, JSON.stringify({ op: 'clearAll' }));
  await proxy.flushPrefs();
  assert.deepEqual(snapshots[snapshots.length - 1], {});
});

test('oversized values are rejected', async (t) => {
  const { proxy, port, prefsPath, snapshots } = await setup();
  t.after(() => proxy.dispose());
  const res = await request(port, 'POST', prefsPath, JSON.stringify({ op: 'set', key: 'big', value: 'x'.repeat(150 * 1024) }));
  assert.equal(res.status, 204);
  await proxy.flushPrefs();
  const last = snapshots[snapshots.length - 1] || {};
  assert.ok(!('big' in last));
});

test('wrong token or method is rejected', async (t) => {
  const { proxy, port } = await setup();
  t.after(() => proxy.dispose());
  const wrong = await request(port, 'POST', '/__phone_preview_prefs_wrong', JSON.stringify({ op: 'set', key: 'a', value: 'b' }));
  assert.equal(wrong.status, 404);
  const get = await request(port, 'GET', '/__phone_preview_prefs_wrong');
  assert.equal(get.status, 404);
});

test('disabled persistence rejects writes', async (t) => {
  const { proxy, port, prefsPath } = await setup({ persistPreferences: false });
  t.after(() => proxy.dispose());
  const res = await request(port, 'POST', prefsPath, JSON.stringify({ op: 'set', key: 'a', value: 'b' }));
  assert.equal(res.status, 404);
  await proxy.flushPrefs();
});

test('malformed bodies do not crash the proxy', async (t) => {
  const { proxy, port, prefsPath } = await setup();
  t.after(() => proxy.dispose());
  const res = await request(port, 'POST', prefsPath, '{oops');
  assert.equal(res.status, 400);
  const res2 = await request(port, 'POST', prefsPath, JSON.stringify({ op: 'set', key: 42, value: 'b' }));
  assert.equal(res2.status, 204);
  await proxy.flushPrefs();
});
