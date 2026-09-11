const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { getPrefsBridge, PREFS_MAX_VALUE_BYTES } = require('../out/prefsBridge');

const endpoint = '/__phone_preview_prefs_test-token';

class MemoryStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
  }
  getItem(key) {
    key = String(key);
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(String(key), String(value));
  }
  removeItem(key) {
    this.map.delete(String(key));
  }
  clear() {
    this.map.clear();
  }
}

function setup(seed, { sendBeacon } = {}) {
  const calls = [];
  const storage = new MemoryStorage();
  const navigator = {};
  if (sendBeacon) {
    navigator.sendBeacon = (...args) => {
      calls.push(args);
      return true;
    };
  }
  const window = {
    localStorage: storage,
    navigator,
    fetch: async (...args) => {
      calls.push(args);
      return {};
    }
  };
  vm.runInNewContext(getPrefsBridge(JSON.stringify(seed), endpoint), { window });
  return { window, storage, calls };
}

function relayBody(call) {
  const raw = typeof call[1] === 'string' ? call[1] : call[1].body;
  const url = typeof call[0] === 'string' ? call[0] : null;
  if (url) assert.equal(url, endpoint);
  return JSON.parse(raw);
}

test('seeds localStorage synchronously from the embedded JSON', () => {
  const { storage } = setup({ theme: 'dark', counter: '3' });
  assert.equal(storage.getItem('theme'), 'dark');
  assert.equal(storage.getItem('counter'), '3');
});

test('does not overwrite values already present when seeding', () => {
  const calls = [];
  const storage = new MemoryStorage({ theme: 'light' });
  const window = { localStorage: storage, navigator: {}, fetch: async (...args) => { calls.push(args); return {}; } };
  vm.runInNewContext(getPrefsBridge(JSON.stringify({ theme: 'dark' }), endpoint), { window });
  assert.equal(storage.getItem('theme'), 'light');
  assert.equal(calls.length, 0);
});

test('setItem relays op=set with key and value', () => {
  const { storage, calls } = setup({});
  storage.setItem('lang', 'es');
  assert.equal(storage.getItem('lang'), 'es');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], endpoint);
  assert.deepEqual(relayBody(calls[0]), { op: 'set', key: 'lang', value: 'es' });
});

test('oversized values are stored locally but never relayed', () => {
  const { storage, calls } = setup({});
  const big = 'x'.repeat(PREFS_MAX_VALUE_BYTES + 1);
  storage.setItem('big', big);
  assert.equal(storage.getItem('big'), big);
  assert.equal(calls.length, 0);
});

test('removeItem relays only mirrored keys', () => {
  const { storage, calls } = setup({ seeded: '1' });
  storage.removeItem('engine-key');
  assert.equal(calls.length, 0);
  storage.removeItem('seeded');
  assert.equal(storage.getItem('seeded'), null);
  assert.equal(calls.length, 1);
  assert.deepEqual(relayBody(calls[0]), { op: 'remove', key: 'seeded' });
});

test('clear removes only mirrored keys and relays clearAll', () => {
  const { storage, calls } = setup({ seeded: '1' });
  storage.map.set('canvaskit-cache', 'blob');
  storage.clear();
  assert.equal(storage.getItem('seeded'), null);
  assert.equal(storage.getItem('canvaskit-cache'), 'blob');
  assert.equal(calls.length, 1);
  assert.deepEqual(relayBody(calls[0]), { op: 'clearAll' });
});

test('prefers sendBeacon when available', () => {
  const { storage, calls } = setup({}, { sendBeacon: true });
  storage.setItem('a', 'b');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], endpoint);
  assert.deepEqual(JSON.parse(calls[0][1]), { op: 'set', key: 'a', value: 'b' });
});

test('an invalid seed never throws', () => {
  const storage = new MemoryStorage();
  const window = { localStorage: storage, navigator: {}, fetch: async () => ({}) };
  assert.doesNotThrow(() => {
    vm.runInNewContext(getPrefsBridge('{oops', endpoint), { window });
  });
});
