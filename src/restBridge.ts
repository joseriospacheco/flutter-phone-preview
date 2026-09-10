// Runs before Flutter boots, so package:http and Dio use the local REST relay.
export function getRestBridge(endpointPath: string): string {
  return String.raw`(() => {
    const endpointPath = ${JSON.stringify(endpointPath)};
    const nativeFetch = window.fetch;
    const NativeRequest = window.Request;

    function externalTarget(value) {
      try {
        const url = new URL(value, document.baseURI || location.href);
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== location.origin ? url : null;
      } catch (_) {
        return null;
      }
    }

    function relayUrl(target, redirect) {
      return endpointPath + '?url=' + encodeURIComponent(target.href) + '&redirect=' + redirect;
    }

    function withResponseMetadata(response, url, redirected) {
      const nativeClone = response.clone;
      Object.defineProperties(response, {
        url: { configurable: true, value: url },
        redirected: { configurable: true, value: redirected },
        clone: { configurable: true, writable: true, value: function() {
          return withResponseMetadata(nativeClone.call(this), url, redirected);
        } }
      });
      return response;
    }

    function abortReason(signal) {
      return signal.reason === undefined ? new DOMException('The operation was aborted.', 'AbortError') : signal.reason;
    }

    async function readBody(request) {
      if (!request.body) return undefined;
      const reader = request.body.getReader();
      const signal = request.signal;
      const abort = () => { reader.cancel(abortReason(signal)).catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        const chunks = [];
        let length = 0;
        while (true) {
          if (signal.aborted) { abort(); throw abortReason(signal); }
          const chunk = await reader.read();
          if (signal.aborted) throw abortReason(signal);
          if (chunk.done) break;
          chunks.push(chunk.value);
          length += chunk.value.byteLength;
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return bytes;
      } finally {
        signal.removeEventListener('abort', abort);
        reader.releaseLock();
      }
    }

    if (nativeFetch && NativeRequest) {
      window.fetch = async function(input, init) {
        const target = externalTarget(input instanceof NativeRequest ? input.url : input);
        if (!target) return nativeFetch.apply(this, arguments);

        // Request merges input/init and serializes FormData with matching headers.
        // Buffering also keeps uploads compatible with the HTTP/1 preview server.
        const request = new NativeRequest(input, init);
        const body = await readBody(request);
        const response = await nativeFetch.call(window, relayUrl(target, request.redirect), {
          method: request.method,
          headers: request.headers,
          body,
          signal: request.signal,
          redirect: request.redirect,
          cache: request.cache,
          integrity: request.integrity,
          keepalive: request.keepalive,
          mode: 'same-origin',
          credentials: 'omit',
          referrerPolicy: 'no-referrer'
        });
        // Keep opaque/manual redirects native and preserve the native body stream.
        if (response.status === 0) return response;
        return withResponseMetadata(response,
          response.headers.get('x-phone-preview-response-url') || target.href,
          response.headers.get('x-phone-preview-redirected') === 'true');
      };
    }

    if (window.XMLHttpRequest) {
      const prototype = window.XMLHttpRequest.prototype;
      const nativeOpen = prototype.open;
      const relayRequests = new WeakMap();
      const responseUrl = Object.getOwnPropertyDescriptor(prototype, 'responseURL');
      if (responseUrl && responseUrl.configurable && responseUrl.get) {
        Object.defineProperty(prototype, 'responseURL', {
          ...responseUrl,
          get: function() {
            if (relayRequests.has(this) && this.readyState >= 2) {
              const target = this.getResponseHeader('x-phone-preview-response-url');
              if (target) return target;
            }
            return responseUrl.get.call(this);
          }
        });
      }
      prototype.open = function(method, url) {
        const target = externalTarget(url);
        // XMLHttpRequest instances can be reopened for ordinary Flutter assets.
        relayRequests.delete(this);
        if (target) relayRequests.set(this, target.href);
        if (!target) return nativeOpen.apply(this, arguments);
        const args = Array.prototype.slice.call(arguments);
        args[1] = relayUrl(target, 'follow');
        return nativeOpen.apply(this, args);
      };
    }
  })();`;
}
