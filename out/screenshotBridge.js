"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScreenshotBridge = getScreenshotBridge;
// Runs inside the served app, in the same context as Flutter's canvas.
//
// Two separate things make the render surface hard to read back:
//
// 1. Discovery. Flutter nests its canvases inside <flt-glass-pane>'s shadow
//    root:  <flutter-view> > <flt-glass-pane> > #shadow-root >
//    <flt-scene-host> > <flt-canvas-container> > <canvas>. On Chromium the
//    WebGL surface is not in the DOM at all - it is an OffscreenCanvas whose
//    frames are transferred into that visible canvas. A plain
//    document.querySelectorAll('canvas') therefore finds nothing, which is the
//    "no-canvas" failure.
//
// 2. Contents. Where the WebGL surface is on screen (Firefox, Safari) it is
//    created without preserveDrawingBuffer, so the browser may discard it right
//    after each composite; an idle app then reads back fully transparent, which
//    was the "blank" failure.
//
// The proxy injects this script into <head>, before the engine boots, so both
// the context patch and the canvas tracking are in place before Flutter asks
// for its first context.
function getScreenshotBridge(token) {
    return String.raw `(() => {
    const token = ${JSON.stringify(token)};

    // Every canvas Flutter asked a rendering context from, in creation order.
    // This finds the surface even when it never enters the DOM.
    const seen = [];

    (function keepBuffers() {
      const patch = proto => {
        if (!proto || typeof proto.getContext !== 'function' || proto.__phonePreviewPatched) return;
        const original = proto.getContext;
        const patched = function (type, attrs) {
          if (typeof type === 'string' && type.indexOf('webgl') === 0) {
            attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
          }
          const context = original.call(this, type, attrs);
          if (context && seen.indexOf(this) === -1 && seen.length < 32) seen.push(this);
          return context;
        };
        proto.getContext = patched;
        proto.__phonePreviewPatched = true;
      };
      if (typeof HTMLCanvasElement === 'function') patch(HTMLCanvasElement.prototype);
      if (typeof OffscreenCanvas === 'function') patch(OffscreenCanvas.prototype);
    })();

    let parentOrigin = null;
    try { parentOrigin = new URL(document.referrer).origin; } catch (_) {}
    const targetOrigin = (parentOrigin && parentOrigin !== 'null') ? parentOrigin : '*';
    let busy = false;

    function send(data, transfer) {
      const message = Object.assign({ source: 'phone-preview-screenshot', token }, data);
      try {
        parent.postMessage(message, targetOrigin, transfer || []);
      } catch (_) {
        try { parent.postMessage(message, targetOrigin); } catch (_) {}
      }
    }

    // A plain querySelectorAll does not cross shadow boundaries, so walk into
    // every shadow root reachable from the given root.
    function collectCanvases(root, found) {
      let list;
      try { list = root.querySelectorAll('canvas'); } catch (_) { return found; }
      for (let i = 0; i < list.length; i++) found.push(list[i]);
      let elements;
      try { elements = root.querySelectorAll('*'); } catch (_) { return found; }
      for (let i = 0; i < elements.length; i++) {
        const shadow = elements[i].shadowRoot;
        if (shadow) collectCanvases(shadow, found);
      }
      return found;
    }

    function largestCanvas() {
      const found = collectCanvases(document, []);
      for (let i = 0; i < seen.length; i++) {
        if (found.indexOf(seen[i]) === -1) found.push(seen[i]);
      }
      let best = null;
      let bestArea = 0;
      for (let i = 0; i < found.length; i++) {
        const canvas = found[i];
        // Only HTMLCanvasElement offers toBlob; the OffscreenCanvas Chromium
        // renders into is not directly capturable and has no visible pixels.
        if (!canvas || typeof canvas.toBlob !== 'function') continue;
        const area = (canvas.width || 0) * (canvas.height || 0);
        if (canvas.width > 1 && canvas.height > 1 && area > bestArea) {
          bestArea = area;
          best = canvas;
        }
      }
      return best;
    }

    function opaqueSamples(canvas) {
      try {
        const tw = 48;
        const th = Math.max(1, Math.round((48 * canvas.height) / Math.max(1, canvas.width)));
        const thumb = document.createElement('canvas');
        thumb.width = tw;
        thumb.height = th;
        const ctx = thumb.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(canvas, 0, 0, tw, th);
        const pixels = ctx.getImageData(0, 0, tw, th).data;
        let opaque = 0;
        let total = 0;
        for (let p = 3; p < pixels.length; p += 16) {
          total++;
          if (pixels[p] > 10) opaque++;
        }
        return { opaque, total };
      } catch (_) {
        return null;
      }
    }

    function nextFrame() {
      return new Promise(resolve => requestAnimationFrame(() => resolve()));
    }

    function canvasToPng(canvas) {
      return new Promise(resolve => {
        try {
          canvas.toBlob(resolve, 'image/png');
        } catch (_) {
          resolve(null);
        }
      });
    }

    async function capture(id) {
      if (busy) {
        send({ id, ok: false, reason: 'busy' });
        return;
      }
      busy = true;
      try {
        let canvas = null;
        // The engine creates its canvas shortly after boot.
        for (let tick = 0; tick < 30 && !canvas; tick++) {
          canvas = largestCanvas();
          if (!canvas) await nextFrame();
        }
        if (!canvas) {
          send({ id, ok: false, reason: 'no-canvas' });
          return;
        }
        // The visible canvas already holds the last transferred frame, so the
        // first attempt usually wins. The remaining ticks cover an engine that
        // has not painted yet (cold start, or a panel that was just revealed),
        // where a real size change is the only nudge Flutter reacts to.
        for (let tick = 0; tick < 30; tick++) {
          canvas = largestCanvas() || canvas;
          const sample = opaqueSamples(canvas);
          if (sample && sample.opaque > sample.total * 0.02) {
            const blob = await canvasToPng(canvas);
            if (blob && blob.size > 0) {
              const buffer = await blob.arrayBuffer();
              send({ id, ok: true, width: canvas.width, height: canvas.height, buffer }, [buffer]);
              return;
            }
          }
          if (tick === 9) {
            try { window.dispatchEvent(new Event('resize')); } catch (_) {}
          }
          await nextFrame();
        }
        send({ id, ok: false, reason: 'blank' });
      } catch (_) {
        send({ id, ok: false, reason: 'error' });
      } finally {
        busy = false;
      }
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (event.source !== parent || !message || message.source !== 'phone-preview-shot' ||
          message.token !== token) return;
      if (typeof message.id !== 'string' && typeof message.id !== 'number') return;
      void capture(message.id);
    });
  })();`;
}
//# sourceMappingURL=screenshotBridge.js.map