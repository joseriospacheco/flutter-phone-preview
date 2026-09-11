"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRuntimeBridge = getRuntimeBridge;
const i18n_1 = require("./i18n");
function getRuntimeBridge(token, lang = 'es') {
    return String.raw `(() => {
    const token = ${JSON.stringify(token)};
    let parentOrigin = '*';
    try {
      const origin = new URL(document.referrer).origin;
      if (origin && origin !== 'null') parentOrigin = origin;
    } catch (_) {}

    let lastRuntimeError = '';
    let lastRuntimeErrorAt = 0;
    const fallbackMessage = ${JSON.stringify((0, i18n_1.t)(lang, 'runtime.unknownAppError'))};
    function reportRuntimeError(kind, value, stack) {
      const message = String(value || fallbackMessage).slice(0, 4000);
      const now = Date.now();
      if (message === lastRuntimeError && now - lastRuntimeErrorAt < 1000) return;
      lastRuntimeError = message;
      lastRuntimeErrorAt = now;
      try {
        parent.postMessage({
          source: 'phone-preview-runtime-error',
          token,
          kind,
          message,
          stack: String(stack || '').slice(0, 4000)
        }, parentOrigin);
      } catch (_) {}
    }
    window.addEventListener('error', event => {
      reportRuntimeError('javascript', event.message, event.error && event.error.stack);
    });
    window.addEventListener('unhandledrejection', event => {
      const reason = event.reason;
      reportRuntimeError(
        'promise',
        reason && reason.message ? reason.message : reason,
        reason && reason.stack
      );
    });
    if (window.console && typeof window.console.error === 'function') {
      const originalConsoleError = window.console.error.bind(window.console);
      window.console.error = (...args) => {
        reportRuntimeError('console', args.map(value => {
          if (value && value.stack) return value.stack;
          try { return typeof value === 'string' ? value : JSON.stringify(value); } catch (_) { return String(value); }
        }).join(' '));
        originalConsoleError(...args);
      };
    }

  })();`;
}
//# sourceMappingURL=runtimeBridge.js.map