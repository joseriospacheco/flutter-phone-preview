// Neutraliza el gesto de pellizco del trackpad (rueda + Ctrl) dentro de la app.
// Flutter Web lo convierte en un evento PointerPanZoom con kind=trackpad y el
// framework lo rechaza con un assert (!identical(kind, PointerDeviceKind.trackpad)),
// tumbando la app en modo debug. Se intercepta en fase de captura en `window`,
// antes de que el listener del engine (en el glasspane) lo reciba: con solo
// preventDefault el engine igual vería el evento y fallaría, por eso también
// se detiene la propagación. El scroll normal del trackpad (sin Ctrl) no se toca.
export function getTrackpadGuard(): string {
  return String.raw`/* phone-preview-trackpad-guard */(() => {
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true, passive: false });
  })();`;
}
