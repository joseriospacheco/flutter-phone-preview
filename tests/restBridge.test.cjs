const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { getRestBridge } = require('../out/restBridge');

const origin = 'http://127.0.0.1:54321';
const endpoint = '/__phone_preview_rest_test-token';

function setup({ responseFactory, xhrResponseURL = true } = {}) {
  const calls = [];
  class XMLHttpRequestStub {
    constructor() {
      this.readyState = 0;
      this.nativeResponseUrl = '';
      this.responseHeaderValues = new Map();
    }
    open(...args) {
      this.openArguments = args;
      this.readyState = 1;
      this.nativeResponseUrl = '';
      this.responseHeaderValues.clear();
      return 'opened';
    }
    get responseURL() { return this.nativeResponseUrl; }
    getResponseHeader(name) {
      return this.readyState < 2 ? null : this.responseHeaderValues.get(name.toLowerCase()) || null;
    }
  }
  if (!xhrResponseURL) delete XMLHttpRequestStub.prototype.responseURL;
  const window = {
    Request,
    XMLHttpRequest: XMLHttpRequestStub,
    fetch: async (...args) => {
      calls.push(args);
      if (args[1]?.signal?.aborted) throw args[1].signal.reason;
      if (responseFactory) return responseFactory(...args);
      return new Response('{"ok":true}', { status: 201, headers: { 'x-api': 'test' } });
    }
  };
  vm.runInNewContext(getRestBridge(endpoint), {
    window, URL, DOMException, Uint8Array,
    document: { baseURI: origin + '/' },
    location: { origin, href: origin + '/' }
  });
  return { window, calls };
}

function inspectRelay(call) {
  const url = new URL(call[0], origin);
  assert.equal(url.pathname, endpoint);
  return { url, init: call[1] };
}

test('fetch relays a JSON POST and keeps API response status and headers', async () => {
  const { window, calls } = setup();
  const response = await window.fetch('https://api.example.test/users?name=Jos%C3%A9', {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: '{"name":"José"}',
    credentials: 'include'
  });
  const { url, init } = inspectRelay(calls[0]);
  assert.equal(url.searchParams.get('url'), 'https://api.example.test/users?name=Jos%C3%A9');
  assert.equal(url.searchParams.get('redirect'), 'follow');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.get('authorization'), 'Bearer secret');
  assert.equal(init.headers.get('content-type'), 'application/json');
  assert.equal(Buffer.from(init.body).toString(), '{"name":"José"}');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.mode, 'same-origin');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('x-api'), 'test');
});

test('fetch preserves a Request body, headers and abort signal', async () => {
  const { window, calls } = setup();
  const aborter = new AbortController();
  const request = new Request('https://api.example.test/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Custom': 'value' },
    body: new Uint8Array([0, 1, 128, 255]),
    signal: aborter.signal
  });
  await window.fetch(request);
  const { init } = inspectRelay(calls[0]);
  assert.deepEqual(Array.from(init.body), [0, 1, 128, 255]);
  assert.equal(init.headers.get('x-custom'), 'value');
  assert.equal(request.bodyUsed, true);
  aborter.abort();
  assert.equal(init.signal.aborted, true);
});

test('fetch init overrides Request method, body, headers, redirect and signal', async () => {
  const { window, calls } = setup();
  const originalAborter = new AbortController();
  const overrideAborter = new AbortController();
  const request = new Request('https://api.example.test/items/1', {
    method: 'POST',
    body: 'original',
    headers: { 'X-Original': 'removed' },
    signal: originalAborter.signal
  });
  await window.fetch(request, {
    method: 'PATCH',
    body: 'replacement',
    headers: { 'X-Replacement': 'yes' },
    signal: overrideAborter.signal,
    redirect: 'manual',
    cache: 'no-store',
    keepalive: true
  });
  const { url, init } = inspectRelay(calls[0]);
  assert.equal(init.method, 'PATCH');
  assert.equal(Buffer.from(init.body).toString(), 'replacement');
  assert.equal(init.headers.get('x-original'), null);
  assert.equal(init.headers.get('x-replacement'), 'yes');
  assert.equal(url.searchParams.get('redirect'), 'manual');
  assert.equal(init.redirect, 'manual');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.keepalive, true);
  originalAborter.abort();
  assert.equal(init.signal.aborted, false);
  overrideAborter.abort();
  assert.equal(init.signal.aborted, true);
});

test('fetch serializes multipart FormData with the same boundary in body and header', async () => {
  const { window, calls } = setup();
  const form = new FormData();
  form.append('name', 'José');
  form.append('file', new Blob([new Uint8Array([0, 128, 255])]), 'avatar.bin');
  await window.fetch('https://api.example.test/upload', { method: 'POST', body: form });
  const { init } = inspectRelay(calls[0]);
  const boundary = init.headers.get('content-type').split('boundary=')[1];
  const bytes = Buffer.from(init.body);
  assert.ok(boundary);
  assert.ok(bytes.toString().startsWith('--' + boundary + '\r\n'));
  assert.ok(bytes.toString().includes('name="name"\r\n\r\nJosé'));
  assert.ok(bytes.toString().includes('filename="avatar.bin"'));
  assert.ok(bytes.includes(Buffer.from([0, 128, 255])));
  assert.ok(bytes.toString().includes('--' + boundary + '--'));
});

test('fetch aborts while reading a pending request body without sending the relay request', async () => {
  const { window, calls } = setup();
  const aborter = new AbortController();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } });
  const request = new Request('https://api.example.test/upload', {
    method: 'POST', body: stream, duplex: 'half', signal: aborter.signal
  });
  const pending = window.fetch(request);
  await new Promise(resolve => setImmediate(resolve));
  aborter.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls.length, 0);
});

test('fetch preserves redirect error and lets native fetch handle an already aborted GET', async () => {
  const { window, calls } = setup();
  const aborter = new AbortController();
  aborter.abort();
  await assert.rejects(window.fetch('https://api.example.test/data', {
    redirect: 'error', signal: aborter.signal
  }), { name: 'AbortError' });
  const { url, init } = inspectRelay(calls[0]);
  assert.equal(url.searchParams.get('redirect'), 'error');
  assert.equal(init.redirect, 'error');
  assert.equal(init.body, undefined);
});

test('fetch leaves same-origin assets and non-HTTP requests untouched', async () => {
  const { window, calls } = setup();
  const request = new Request(origin + '/main.dart.js');
  const inputs = ['/flutter.js', origin + '/assets/a.png', request, 'data:text/plain,hello', 'blob:' + origin + '/123'];
  for (const input of inputs) {
    const init = { headers: { 'X-Untouched': 'yes' } };
    await window.fetch(input, init);
    const last = calls.at(-1);
    assert.equal(last[0], input);
    assert.equal(last[1], init);
  }
});

test('fetch rejects a previously consumed Request body without sending it', async () => {
  const { window, calls } = setup();
  const request = new Request('https://api.example.test/upload', { method: 'POST', body: 'once' });
  await request.text();
  await assert.rejects(window.fetch(request), TypeError);
  assert.equal(calls.length, 0);
});

test('XHR relays cross-origin URLs and preserves open arguments', () => {
  const { window } = setup();
  const xhr = new window.XMLHttpRequest();
  const result = xhr.open('PATCH', 'http://localhost:8080/api/items?a=1&b=2', false, 'user', 'password');
  assert.equal(result, 'opened');
  assert.equal(xhr.openArguments[0], 'PATCH');
  const url = new URL(xhr.openArguments[1], origin);
  assert.equal(url.pathname, endpoint);
  assert.equal(url.searchParams.get('url'), 'http://localhost:8080/api/items?a=1&b=2');
  assert.equal(url.searchParams.get('redirect'), 'follow');
  assert.deepEqual(xhr.openArguments.slice(2), [false, 'user', 'password']);
});

test('XHR keeps same-origin and non-HTTP URLs unchanged, including optional argument count', () => {
  const { window } = setup();
  for (const target of ['/assets/FontManifest.json', origin + '/flutter.js', 'data:text/plain,hello']) {
    const xhr = new window.XMLHttpRequest();
    xhr.open('GET', target);
    assert.deepEqual(xhr.openArguments, ['GET', target]);
  }
});

test('fetch preserves original response URL and redirected metadata through clones', async () => {
  const apiUrl = 'https://api.example.test/final';
  const nativeResponse = new Response('response body', {
    headers: { 'x-phone-preview-response-url': apiUrl, 'x-phone-preview-redirected': 'true' }
  });
  const nativeBody = nativeResponse.body;
  const { window } = setup({ responseFactory: () => nativeResponse });
  const response = await window.fetch('https://api.example.test/redirect');
  assert.equal(response, nativeResponse);
  assert.equal(response.body, nativeBody);
  assert.ok(response instanceof Response);
  assert.equal(response.url, apiUrl);
  assert.equal(response.redirected, true);
  const clone = response.clone();
  const secondClone = clone.clone();
  assert.ok(clone instanceof Response);
  assert.equal(clone.url, apiUrl);
  assert.equal(clone.redirected, true);
  assert.equal(secondClone.url, apiUrl);
  assert.equal(secondClone.redirected, true);
  assert.deepEqual(await Promise.all([response.text(), clone.text(), secondClone.text()]),
    ['response body', 'response body', 'response body']);
  assert.throws(() => response.clone(), TypeError);
});

test('fetch preserves nonredirected API URL metadata and leaves status-zero responses native', async () => {
  const apiUrl = 'https://api.example.test/items';
  const { window } = setup({ responseFactory: () => new Response('ok', {
    headers: { 'x-phone-preview-response-url': apiUrl, 'x-phone-preview-redirected': 'false' }
  }) });
  const response = await window.fetch(apiUrl);
  assert.equal(response.url, apiUrl);
  assert.equal(response.redirected, false);
  const opaque = Response.error();
  const opaqueClone = opaque.clone;
  const { window: opaqueWindow } = setup({ responseFactory: () => opaque });
  assert.equal(await opaqueWindow.fetch(apiUrl, { redirect: 'manual' }), opaque);
  assert.equal(opaque.url, '');
  assert.equal(opaque.redirected, false);
  assert.equal(opaque.clone, opaqueClone);
  assert.equal(Object.hasOwn(opaque, 'url'), false);
});

test('XHR reports original response URL after headers and resets when reused for same-origin assets', () => {
  const { window } = setup();
  const xhr = new window.XMLHttpRequest();
  xhr.open('GET', 'https://api.example.test/redirect');
  assert.equal(xhr.responseURL, '');
  xhr.nativeResponseUrl = origin + endpoint + '?url=hidden';
  xhr.responseHeaderValues.set('x-phone-preview-response-url', 'https://api.example.test/final');
  xhr.readyState = 2;
  assert.equal(xhr.responseURL, 'https://api.example.test/final');
  xhr.readyState = 4;
  assert.equal(xhr.responseURL, 'https://api.example.test/final');
  xhr.open('GET', '/main.dart.js');
  assert.equal(xhr.responseURL, '');
  xhr.readyState = 4;
  xhr.nativeResponseUrl = origin + '/main.dart.js';
  xhr.responseHeaderValues.set('x-phone-preview-response-url', 'https://unrelated.example.test/');
  assert.equal(xhr.responseURL, origin + '/main.dart.js');
});

test('XHR falls back to native responseURL without relay metadata and supports minimal mocks', () => {
  const { window } = setup();
  const xhr = new window.XMLHttpRequest();
  xhr.open('GET', 'https://api.example.test/failure');
  xhr.readyState = 4;
  assert.equal(xhr.responseURL, '');
  const { window: minimalWindow } = setup({ xhrResponseURL: false });
  const minimalXhr = new minimalWindow.XMLHttpRequest();
  assert.equal(minimalXhr.open('GET', 'https://api.example.test/items'), 'opened');
  assert.equal(new URL(minimalXhr.openArguments[1], origin).pathname, endpoint);
});
