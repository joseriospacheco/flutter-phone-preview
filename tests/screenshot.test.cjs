const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { buildScreenshotFilename, isScreenshotResult } = require('../out/screenshot.js');
const { getScreenshotBridge } = require('../out/screenshotBridge.js');

const fixedDate = new Date(2026, 8, 30, 15, 30, 5);

test('buildScreenshotFilename uses device, orientation and timestamp', () => {
  assert.equal(
    buildScreenshotFilename('iphone15', false, fixedDate),
    'flutter-iphone15-portrait-20260930-153005.png'
  );
  assert.equal(
    buildScreenshotFilename('galaxy_s24_ultra', true, fixedDate),
    'flutter-galaxy-s24-ultra-landscape-20260930-153005.png'
  );
});

test('buildScreenshotFilename sanitizes hostile device ids', () => {
  assert.equal(
    buildScreenshotFilename('../../etc/passwd', false, fixedDate),
    'flutter-etc-passwd-portrait-20260930-153005.png'
  );
  assert.equal(
    buildScreenshotFilename('', false, fixedDate),
    'flutter-device-portrait-20260930-153005.png'
  );
});

test('isScreenshotResult accepts only matching token messages', () => {
  assert.equal(isScreenshotResult({ source: 'phone-preview-screenshot', token: 'abc', id: 1, ok: true }, 'abc'), true);
  assert.equal(isScreenshotResult({ source: 'phone-preview-screenshot', token: 'abc', id: 'x', ok: false }, 'abc'), true);
  assert.equal(isScreenshotResult({ source: 'phone-preview-screenshot', token: 'abc', id: 1, ok: true }, 'other'), false);
  assert.equal(isScreenshotResult({ source: 'phone-preview-screenshot', token: 'abc', id: 1 }, 'abc'), false);
  assert.equal(isScreenshotResult({ source: 'phone-preview-runtime-error', token: 'abc', id: 1, ok: true }, 'abc'), false);
  assert.equal(isScreenshotResult(null, 'abc'), false);
  assert.equal(isScreenshotResult('phone-preview-screenshot', 'abc'), false);
  assert.equal(isScreenshotResult({ source: 'phone-preview-screenshot', token: 'abc', id: null, ok: true }, 'abc'), false);
});

test('getScreenshotBridge embeds the session token and the capture protocol', () => {
  const token = 'tok-123 Sonderzeichen ä';
  const bridge = getScreenshotBridge(token);
  assert.ok(bridge.includes(JSON.stringify(token)), 'the token must be embedded safely');
  assert.ok(bridge.includes('phone-preview-shot'), 'listens for capture requests');
  assert.ok(bridge.includes('phone-preview-screenshot'), 'answers with capture results');
  assert.ok(bridge.includes('canvas'), 'targets the Flutter canvas');
  assert.ok(!bridge.includes('undefined'), 'no accidental undefined literals');
  assert.ok(!getScreenshotBridge('other').includes(JSON.stringify(token)), 'tokens must not leak across sessions');
});

// Loads the bridge in a minimal DOM stub so the context patch can be observed.
// Flutter's CanvasKit surface is created without preserveDrawingBuffer, so the
// browser drops its contents after every composite: an idle app then reads back
// fully transparent, which is the "blank" capture failure this guards.
function loadBridge() {
  const calls = [];
  function HTMLCanvasElement() {}
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    calls.push({ type, attrs });
    return { type, attrs };
  };
  const sandbox = {
    URL,
    console,
    HTMLCanvasElement,
    requestAnimationFrame: () => 0,
    parent: { postMessage() {} },
    document: { referrer: '', querySelectorAll: () => [] },
    window: { addEventListener() {}, HTMLCanvasElement }
  };
  vm.runInNewContext(getScreenshotBridge('tok'), sandbox);
  return { HTMLCanvasElement, calls };
}

test('getScreenshotBridge keeps the WebGL drawing buffer readable', () => {
  const { HTMLCanvasElement, calls } = loadBridge();
  const canvas = new HTMLCanvasElement();

  canvas.getContext('webgl2', { alpha: true, antialias: false });
  assert.equal(calls[0].attrs.preserveDrawingBuffer, true, 'webgl2 contexts must preserve the drawing buffer');

  canvas.getContext('webgl');
  assert.equal(calls[1].attrs.preserveDrawingBuffer, true, 'webgl1 contexts must preserve the drawing buffer too');
});

test('getScreenshotBridge leaves other contexts and caller attributes alone', () => {
  const { HTMLCanvasElement, calls } = loadBridge();
  const canvas = new HTMLCanvasElement();

  canvas.getContext('2d', { willReadFrequently: true });
  assert.equal(calls[0].attrs.preserveDrawingBuffer, undefined, '2d contexts must not be touched');

  const callerAttrs = { alpha: false };
  canvas.getContext('webgl', callerAttrs);
  assert.equal(callerAttrs.preserveDrawingBuffer, undefined, 'the caller object must not be mutated');
  assert.equal(calls[1].attrs.preserveDrawingBuffer, true, 'the patched copy must still force the flag');
});

// Flutter nests its canvases inside <flt-glass-pane>'s shadow root:
//   <flutter-view> > <flt-glass-pane> > #shadow-root > <flt-scene-host> >
//   <flt-canvas-container> > <canvas>
// querySelectorAll does not cross shadow boundaries, so the stub below models
// that nesting and a light DOM that holds no canvas at all.
function makeStubCanvas(width, height) {
  return {
    width,
    height,
    toBlob(callback) {
      callback({ size: 32, arrayBuffer: async () => new ArrayBuffer(32) });
    }
  };
}

// opaqueSamples() renders the target into a scratch 2d canvas and reads it.
function makeScratchCanvas() {
  return {
    width: 1,
    height: 1,
    getContext() {
      return {
        drawImage() {},
        getImageData(x, y, w, h) {
          const data = new Uint8ClampedArray(Math.max(4, w * h * 4));
          data.fill(255);
          return { data };
        }
      };
    }
  };
}

async function captureFrom(options) {
  const canvas = options.canvas || null;
  let listener = null;
  let resolveReply = null;
  const reply = new Promise(resolve => { resolveReply = resolve; });
  const parent = {
    postMessage(message) { resolveReply(message); }
  };
  const shadowRoot = {
    querySelectorAll(selector) {
      if (!canvas) return [];
      return selector === 'canvas' ? [canvas] : [];
    }
  };
  const document = {
    referrer: '',
    querySelectorAll(selector) {
      return selector === 'canvas' ? [] : [{ shadowRoot }];
    },
    createElement() { return makeScratchCanvas(); }
  };
  const sandbox = {
    URL,
    console,
    setTimeout,
    HTMLCanvasElement: function () {},
    OffscreenCanvas: function () {},
    requestAnimationFrame: callback => setTimeout(callback, 0),
    parent,
    document,
    window: {
      addEventListener(type, handler) { if (type === 'message') listener = handler; },
      dispatchEvent() {}
    }
  };
  sandbox.HTMLCanvasElement.prototype.getContext = () => ({});
  sandbox.OffscreenCanvas.prototype.getContext = () => ({});
  vm.runInNewContext(getScreenshotBridge('tok'), sandbox);
  listener({ source: parent, data: { source: 'phone-preview-shot', token: 'tok', id: 1 } });
  return reply;
}

test('getScreenshotBridge captures a canvas nested in a shadow root', async () => {
  const reply = await captureFrom({ canvas: makeStubCanvas(400, 800) });
  assert.equal(reply.ok, true, 'the canvas inside <flt-glass-pane> must be found');
  assert.equal(reply.width, 400);
  assert.equal(reply.height, 800);
});

test('getScreenshotBridge ignores candidates that cannot produce a PNG', async () => {
  // The OffscreenCanvas Chromium renders into has convertToBlob, not toBlob,
  // and none of the visible pixels; it must not shadow the real canvas.
  const reply = await captureFrom({ canvas: { width: 400, height: 800 } });
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, 'no-canvas');
});

test('getScreenshotBridge reports no-canvas when there is no canvas at all', async () => {
  const reply = await captureFrom({});
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, 'no-canvas');
});
