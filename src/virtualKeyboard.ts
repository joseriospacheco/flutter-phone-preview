import { Lang, t } from './i18n';

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

export function getKeyboardMarkup(lang: Lang = 'es'): string {
  return `<section class="virtual-keyboard" id="virtualKeyboard" aria-label="${t(lang, 'keyboard.label')}" hidden>
  <div class="vk-caption"><span id="keyboardTypeLabel">${t(lang, 'keyboard.text')}</span><button type="button" id="keyboardDone" aria-label="${t(lang, 'keyboard.confirm')}">${t(lang, 'keyboard.done')}</button><button type="button" id="keyboardHide" aria-label="${t(lang, 'keyboard.hide')}" title="${t(lang, 'keyboard.hide')}">⌄</button></div>
  <div class="vk-rows" id="keyboardRows"></div>
</section>`;
}

// Kept for compatibility; new code should use getKeyboardMarkup(lang).
export const keyboardMarkup = getKeyboardMarkup();

// Shares only the iframe reference and phone layout with the webview script.
export function getVirtualKeyboardScript(token: string, lang: Lang = 'es'): string {
  const kb = {
    done: t(lang, 'keyboard.done'),
    text: t(lang, 'keyboard.text'),
    multiline: t(lang, 'keyboard.multiline'),
    space: t(lang, 'keyboard.space'),
    shift: t(lang, 'keyboard.shift'),
    backspace: t(lang, 'keyboard.backspace'),
    showLetters: t(lang, 'keyboard.showLetters'),
    showSymbols: t(lang, 'keyboard.showSymbols'),
    actions: {
      enter: t(lang, 'keyboard.action.enter'),
      done: t(lang, 'keyboard.action.done'),
      next: t(lang, 'keyboard.action.next'),
      previous: t(lang, 'keyboard.action.previous'),
      search: t(lang, 'keyboard.action.search'),
      send: t(lang, 'keyboard.action.send'),
      go: t(lang, 'keyboard.action.go')
    },
    modes: {
      numeric: t(lang, 'keyboard.mode.numeric'),
      decimal: t(lang, 'keyboard.mode.decimal'),
      tel: t(lang, 'keyboard.mode.tel'),
      email: t(lang, 'keyboard.mode.email'),
      url: t(lang, 'keyboard.mode.url'),
      search: t(lang, 'keyboard.mode.search')
    }
  };
  return String.raw`
    const keyboardToken = ${JSON.stringify(token)};
    const keyboardStrings = ${JSON.stringify(kb)};
    const virtualKeyboard = document.getElementById('virtualKeyboard');
    const keyboardRows = document.getElementById('keyboardRows');
    let keyboardState = { visible: false, fieldId: -1, mode: 'text', action: 'done', multiline: false };
    let shifted = false;
    let symbols = false;
    const actionLabels = keyboardStrings.actions;
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
      const labels = { numeric: keyboardStrings.modes.numeric, decimal: keyboardStrings.modes.decimal, tel: keyboardStrings.modes.tel, email: keyboardStrings.modes.email, url: keyboardStrings.modes.url, search: keyboardStrings.modes.search };
      document.getElementById('keyboardTypeLabel').textContent = labels[mode] || (keyboardState.multiline ? keyboardStrings.multiline : keyboardStrings.text);
      document.getElementById('keyboardDone').textContent = actionLabels[keyboardState.action] || keyboardStrings.done;
      keyboardRows.replaceChildren();
      function row(keys) {
        const element = document.createElement('div'); element.className = 'vk-row';
        for (const key of keys) {
          const button = document.createElement('button'); button.type = 'button';
          const special = { shift: shifted ? '⇧' : '⇧', backspace: '⌫', symbols: symbols ? 'ABC' : '123', space: keyboardStrings.space, enter: actionLabels[keyboardState.action] || keyboardStrings.done };
          button.textContent = special[key] || key;
          const names = { shift: keyboardStrings.shift, backspace: keyboardStrings.backspace, symbols: symbols ? keyboardStrings.showLetters : keyboardStrings.showSymbols, space: keyboardStrings.space, enter: actionLabels[keyboardState.action] || keyboardStrings.done };
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
