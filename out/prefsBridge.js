"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREFS_MAX_VALUE_BYTES = void 0;
exports.getPrefsBridge = getPrefsBridge;
// Se inyecta en el <head> antes de que arranque Flutter, igual que el resto
// de puentes. Hace que `shared_preferences` (que en Web usa localStorage)
// sobreviva a los reinicios de la vista previa: el proxy escucha en un
// puerto aleatorio en cada arranque, así que sin este espejo cada sesión
// vería un origen nuevo y los prefs "desaparecerían".
exports.PREFS_MAX_VALUE_BYTES = 100 * 1024;
function getPrefsBridge(seedJson, endpointPath) {
    return String.raw `(() => {
    const endpointPath = ${JSON.stringify(endpointPath)};
    const maxValueBytes = ${exports.PREFS_MAX_VALUE_BYTES};
    let seed = {};
    try {
      const parsed = JSON.parse(${JSON.stringify(seedJson)});
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) seed = parsed;
    } catch (_) {}
    const mirrored = new Set();

    function relay(op, key, value) {
      try {
        const body = JSON.stringify(value === undefined ? { op, key } : { op, key, value });
        const nav = window.navigator || {};
        if (nav.sendBeacon) {
          try { nav.sendBeacon(endpointPath, body); return; } catch (_) {}
        }
        window.fetch(endpointPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true
        }).catch(() => {});
      } catch (_) {}
    }

    try {
      const ls = window.localStorage;
      if (!ls) return;
      // Precarga síncrona: shared_preferences lee al arrancar, no podemos
      // esperar ningún handshake asíncrono.
      for (const key of Object.keys(seed)) {
        const value = seed[key];
        if (typeof value !== 'string' || value.length > maxValueBytes) continue;
        mirrored.add(key);
        try {
          if (ls.getItem(key) === null) ls.setItem(key, value);
        } catch (_) {}
      }
      const origSet = ls.setItem.bind(ls);
      const origRemove = ls.removeItem.bind(ls);
      ls.setItem = function(key, value) {
        key = String(key);
        value = String(value);
        const result = origSet(key, value);
        if (value.length <= maxValueBytes) {
          mirrored.add(key);
          relay('set', key, value);
        }
        return result;
      };
      ls.removeItem = function(key) {
        key = String(key);
        const result = origRemove(key);
        if (mirrored.delete(key)) relay('remove', key);
        return result;
      };
      ls.clear = function() {
        // Solo borra las claves espejadas: nunca toca datos del motor
        // (cachés de CanvasKit, etc.) que shared_preferences no gestiona.
        for (const key of Array.from(mirrored)) {
          try { origRemove(key); } catch (_) {}
        }
        mirrored.clear();
        relay('clearAll');
      };
    } catch (_) {}
  })();`;
}
//# sourceMappingURL=prefsBridge.js.map