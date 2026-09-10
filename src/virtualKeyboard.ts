export const keyboardStyles = String.raw`
  .virtual-keyboard {
    position: absolute; inset: auto 0 0; z-index: 6;
    height: var(--keyboard-height, 280px); padding: 6px 5px 14px;
    display: flex; flex-direction: column; gap: 6px;
    background: var(--vscode-editorWidget-background, #20252f);
    color: var(--vscode-foreground, #dbe2ec);
    border-top: 1px solid var(--line); user-select: none;
  }
  .virtual-keyboard[hidden] { display: none; }
  .vk-caption { display: flex; align-items: center; gap: 8px; min-height: 24px; padding: 0 6px; }
  .vk-caption > span { flex: 1; font-size: 11px; color: var(--muted); }
  .virtual-keyboard button {
    display: flex; align-items: center; justify-content: center;
    padding: 0 3px; min-width: 0; border: 1px solid var(--line); border-radius: 6px;
    color: inherit; background: var(--vscode-input-background, #2d3440);
    font: inherit; font-size: 19px; cursor: pointer;
    box-shadow: 0 1px 0 var(--line); touch-action: manipulation;
  }
  .virtual-keyboard button:hover { background: var(--vscode-toolbar-hoverBackground, #3b4657); }
  .virtual-keyboard button:active { background: var(--vscode-button-background, #087ca7); color: var(--vscode-button-foreground, #fff); }
  .virtual-keyboard .vk-special { font-size: 12px; background: var(--surface); }
  .virtual-keyboard .vk-action { background: var(--vscode-button-background, #087ca7); color: var(--vscode-button-foreground, #fff); font-size: 12px; }
  .vk-caption button { height: 24px; padding: 0 8px; font-size: 11px; box-shadow: none; }
  .vk-rows { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
  .vk-row { flex: 1; min-height: 0; display: flex; justify-content: center; gap: 4px; }
  .vk-row > button { flex: 1; }
  .vk-row > .vk-wide { flex: 1.5; }
  .vk-row > .vk-space { flex: 5; font-size: 12px; }
  .virtual-keyboard[data-landscape="true"] { padding-bottom: 6px; gap: 4px; }
  .virtual-keyboard[data-landscape="true"] .vk-rows { gap: 3px; }
`;

export const keyboardMarkup = `<section class="virtual-keyboard" id="virtualKeyboard" aria-label="Teclado virtual" hidden>
  <div class="vk-caption"><span id="keyboardTypeLabel">Texto</span><button type="button" id="keyboardDone" aria-label="Confirmar entrada">Listo</button><button type="button" id="keyboardHide" aria-label="Ocultar teclado" title="Ocultar teclado">⌄</button></div>
  <div class="vk-rows" id="keyboardRows"></div>
</section>`;

// Shares only the iframe reference and phone layout with the webview script.
export function getVirtualKeyboardScript(token: string): string {
  return String.raw`
    const keyboardToken = ${JSON.stringify(token)};
    const virtualKeyboard = document.getElementById('virtualKeyboard');
    const keyboardRows = document.getElementById('keyboardRows');
    let keyboardState = { visible: false, fieldId: -1, mode: 'text', action: 'done', multiline: false };
    let shifted = false;
    let symbols = false;
    const actionLabels = { enter: 'Intro', done: 'Listo', next: 'Siguiente', previous: 'Anterior', search: 'Buscar', send: 'Enviar', go: 'Ir' };
    function layoutKeyboard() {
      const screen = phone.querySelector('.screen');
      const inset = parseFloat(preview.style.top) || 0;
      const available = Math.max(0, screen.clientHeight - inset);
      const height = keyboardState.visible ? Math.min(rotated ? 190 : 280, Math.floor(available * 0.52)) : 0;
      virtualKeyboard.hidden = !keyboardState.visible;
      virtualKeyboard.style.setProperty('--keyboard-height', height + 'px');
      virtualKeyboard.dataset.landscape = String(rotated);
      preview.style.height = 'calc(100% - ' + (inset + height) + 'px)';
    }
    function resetKeyboard() {
      keyboardState.visible = false;
      layoutKeyboard();
    }
    function sendKeyboardKey(action, text) {
      if (!keyboardState.visible) return;
      preview.contentWindow.postMessage({ source: 'phone-preview-key', token: keyboardToken, fieldId: keyboardState.fieldId, action, text }, new URL(preview.src).origin);
    }
    function renderKeyboard() {
      const mode = keyboardState.mode;
      const numeric = ['numeric', 'decimal', 'tel'].includes(mode);
      const labels = { numeric: 'Números', decimal: 'Decimales', tel: 'Teléfono', email: 'Correo electrónico', url: 'Dirección web', search: 'Búsqueda' };
      document.getElementById('keyboardTypeLabel').textContent = labels[mode] || (keyboardState.multiline ? 'Texto multilínea' : 'Texto');
      document.getElementById('keyboardDone').textContent = actionLabels[keyboardState.action] || 'Listo';
      keyboardRows.replaceChildren();
      function row(keys) {
        const element = document.createElement('div'); element.className = 'vk-row';
        for (const key of keys) {
          const button = document.createElement('button'); button.type = 'button';
          const special = { shift: shifted ? '⇧' : '⇧', backspace: '⌫', symbols: symbols ? 'ABC' : '123', space: 'espacio', enter: actionLabels[keyboardState.action] || 'Listo' };
          button.textContent = special[key] || key;
          const names = { shift: 'Mayúsculas', backspace: 'Borrar', symbols: symbols ? 'Mostrar letras' : 'Mostrar símbolos', space: 'Espacio', enter: actionLabels[keyboardState.action] || 'Listo' };
          button.setAttribute('aria-label', names[key] || key);
          if (special[key]) button.className = 'vk-special vk-wide';
          if (key === 'space') button.className = 'vk-space';
          if (key === 'enter') button.className = 'vk-action vk-wide';
          if (key === 'shift') button.setAttribute('aria-pressed', String(shifted));
          button.addEventListener('click', () => {
            if (key === 'shift') { shifted = !shifted; renderKeyboard(); }
            else if (key === 'symbols') { symbols = !symbols; renderKeyboard(); }
            else if (key === 'backspace' || key === 'enter') sendKeyboardKey(key);
            else { sendKeyboardKey('insert', key === 'space' ? ' ' : key); if (shifted) { shifted = false; renderKeyboard(); } }
          });
          element.appendChild(button);
        }
        keyboardRows.appendChild(element);
      }
      if (numeric) {
        row(['1', '2', '3']); row(['4', '5', '6']); row(['7', '8', '9']);
        row([mode === 'decimal' ? '.' : mode === 'tel' ? '+' : '-', '0', 'backspace']);
        if (mode === 'tel') row(['*', '#', 'enter']);
        if (mode === 'decimal') row(['-', ',', 'enter']);
      } else {
        if (symbols) {
          row(Array.from('1234567890')); row(['@', '#', '$', '%', '&', '*', '-', '+', '(', ')']); row(['!', '?', ':', ';', '/', '_', '=', 'backspace']);
        } else {
          row(Array.from(shifted ? 'QWERTYUIOP' : 'qwertyuiop'));
          row(Array.from(shifted ? 'ASDFGHJKLÑ' : 'asdfghjklñ'));
          row(['shift', ...Array.from(shifted ? 'ZXCVBNM' : 'zxcvbnm'), 'backspace']);
        }
        row(['symbols', mode === 'email' ? '@' : mode === 'url' ? '/' : ',', 'space', '.', 'enter']);
      }
      layoutKeyboard();
    }
    // Mouse/touch keys must keep the Flutter field focused.
    virtualKeyboard.addEventListener('pointerdown', event => event.preventDefault());
    document.getElementById('keyboardHide').addEventListener('click', () => { sendKeyboardKey('hide'); resetKeyboard(); });
    document.getElementById('keyboardDone').addEventListener('click', () => sendKeyboardKey('enter'));
    window.addEventListener('message', event => {
      const message = event.data;
      if (event.source !== preview.contentWindow || event.origin !== new URL(baseUrl).origin || !message ||
          message.source !== 'phone-preview-keyboard' || message.token !== keyboardToken) return;
      if (message.fieldId !== keyboardState.fieldId || message.mode !== keyboardState.mode) { shifted = false; symbols = false; }
      keyboardState = message;
      if (message.visible) renderKeyboard(); else layoutKeyboard();
    });
  `;
}
