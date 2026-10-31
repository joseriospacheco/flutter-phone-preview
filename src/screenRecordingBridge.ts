/** Captures the Flutter canvas inside the app frame and streams WebM chunks to the preview. */
export function getScreenRecordingBridge(token: string): string {
  return String.raw`(() => {
    const token = ${JSON.stringify(token)};
    let parentOrigin = '*';
    try {
      const origin = new URL(document.referrer).origin;
      if (origin && origin !== 'null') parentOrigin = origin;
    } catch (_) {}

    let recorder = null;
    let stream = null;
    let chunkChain = Promise.resolve();
    let chunkIndex = 0;
    const trackedCanvases = [];

    function send(event, detail, transfer) {
      const message = Object.assign({ source: 'phone-preview-recording', token, event }, detail || {});
      try { parent.postMessage(message, parentOrigin, transfer || []); }
      catch (_) { try { parent.postMessage(message, parentOrigin); } catch (_) {} }
    }

    function encodeBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 8192));
      }
      return btoa(binary);
    }

    function trackCanvasPrototype(proto) {
      if (!proto || typeof proto.getContext !== 'function' || proto.__phonePreviewRecordingPatched) return;
      const original = proto.getContext;
      proto.getContext = function (...args) {
        const context = original.apply(this, args);
        if (context && trackedCanvases.indexOf(this) < 0 && trackedCanvases.length < 32) trackedCanvases.push(this);
        return context;
      };
      proto.__phonePreviewRecordingPatched = true;
    }
    if (typeof HTMLCanvasElement === 'function') trackCanvasPrototype(HTMLCanvasElement.prototype);
    if (typeof OffscreenCanvas === 'function') trackCanvasPrototype(OffscreenCanvas.prototype);

    function findCanvas() {
      const found = [];
      const walk = root => {
        let elements;
        try { elements = root.querySelectorAll('*'); } catch (_) { return; }
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          if (element.tagName === 'CANVAS') found.push(element);
          if (element.shadowRoot) walk(element.shadowRoot);
        }
      };
      walk(document);
      for (const canvas of trackedCanvases) if (found.indexOf(canvas) < 0) found.push(canvas);
      let best = null;
      let area = 0;
      for (const canvas of found) {
        if (!canvas || typeof canvas.captureStream !== 'function') continue;
        const candidateArea = (canvas.width || 0) * (canvas.height || 0);
        if (canvas.width > 1 && canvas.height > 1 && candidateArea > area) {
          best = canvas;
          area = candidateArea;
        }
      }
      return best;
    }

    async function start() {
      if (recorder && recorder.state !== 'inactive') return;
      try {
        let canvas = null;
        for (let tick = 0; tick < 80 && !canvas; tick++) {
          canvas = findCanvas();
          if (!canvas) await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!canvas) throw new Error('No se encontró la pantalla de Flutter.');
        if (typeof MediaRecorder !== 'function') throw new Error('Este entorno no admite grabación de vídeo.');
        stream = canvas.captureStream(30);
        const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
          .find(type => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type));
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        chunkChain = Promise.resolve();
        chunkIndex = 0;
        recorder.addEventListener('dataavailable', event => {
          if (!event.data || event.data.size === 0) return;
          chunkChain = chunkChain.then(async () => {
            const buffer = await event.data.arrayBuffer();
            send('chunk', { index: chunkIndex++, data: encodeBase64(buffer) });
          }).catch(error => send('error', { message: String(error && error.message || error) }));
        });
        recorder.addEventListener('start', () => send('started', { mimeType: recorder.mimeType || mimeType || 'video/webm' }));
        recorder.addEventListener('error', event => send('error', { message: String(event.error && event.error.message || 'Error al grabar la pantalla.') }));
        recorder.addEventListener('stop', () => {
          chunkChain.then(() => {
            if (stream) for (const track of stream.getTracks()) track.stop();
            stream = null;
            send('stopped', { chunks: chunkIndex });
            recorder = null;
          });
        }, { once: true });
        recorder.start(1000);
      } catch (error) {
        if (stream) for (const track of stream.getTracks()) track.stop();
        stream = null;
        recorder = null;
        send('error', { message: String(error && error.message || error) });
      }
    }

    function stop() {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (event.source !== parent || !message || message.source !== 'phone-preview-record-control' || message.token !== token) return;
      if (message.action === 'start') void start();
      else if (message.action === 'stop') stop();
    });
  })();`;
}
