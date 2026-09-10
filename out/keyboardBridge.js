"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKeyboardBridge = getKeyboardBridge;
// Runs inside the served app, before Flutter initializes. Never forwards field values.
function getKeyboardBridge(token, device) {
    return String.raw `(() => {
    const token = ${JSON.stringify(token)};
    const ios = ${JSON.stringify(/^(iphone|ipad)/.test(device))};
    // Flutter only assigns numeric/email/etc. inputmode attributes on mobile.
    // Keep the actual browser engine; emulate only its mobile platform locally.
    const originalAgent = navigator.userAgent;
    try {
      Object.defineProperty(navigator, 'platform', { configurable: true, get: () => ios ? 'iPhone' : 'Linux armv8l' });
      if (!ios) Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => originalAgent + ' Android' });
    } catch (_) {}
    let active = null;
    let fieldId = 0;
    let lastState = '';
    let parentOrigin = null;
    try { parentOrigin = new URL(document.referrer).origin; } catch (_) {}
    const send = data => parent.postMessage({ source: 'phone-preview-keyboard', token, ...data }, parentOrigin && parentOrigin !== 'null' ? parentOrigin : '*');
    function focusedElement() {
      let element = document.activeElement;
      while (element && element.shadowRoot && element.shadowRoot.activeElement) element = element.shadowRoot.activeElement;
      return element;
    }
    function editable(element) {
      return element && element.isConnected && !element.disabled && !element.readOnly &&
        (element.tagName === 'TEXTAREA' || (element.tagName === 'INPUT' && /^(text|search|email|url|tel|password|number)$/.test(element.type)));
    }
    function sync() {
      const element = focusedElement();
      if (element !== active) { active = element; fieldId++; }
      let state = { visible: false, fieldId };
      if (editable(active) && active.inputMode !== 'none') {
        const mode = active.inputMode || ({ number: 'decimal', tel: 'tel', email: 'email', url: 'url', search: 'search' }[active.type]) || 'text';
        state = { visible: true, fieldId, mode, multiline: active.tagName === 'TEXTAREA', action: active.enterKeyHint || (active.tagName === 'TEXTAREA' ? 'enter' : 'done') };
      }
      const serialized = JSON.stringify(state);
      if (serialized !== lastState) { lastState = serialized; send(state); }
    }
    document.addEventListener('focusin', sync, true);
    document.addEventListener('focusout', () => setTimeout(sync, 0), true);
    // Flutter can reuse the same hidden input and update only its attributes.
    new MutationObserver(sync).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['inputmode', 'type', 'readonly', 'disabled', 'enterkeyhint']
    });
    function edit(text, deleting = false) {
      const element = active;
      const value = element.value;
      let start = element.selectionStart ?? value.length;
      const end = element.selectionEnd ?? start;
      if (deleting && start === end && start > 0) {
        // Delete the previous full Unicode code point (not half a surrogate pair).
        start -= Array.from(value.slice(0, start)).pop().length;
      }
      const inputType = deleting ? 'deleteContentBackward' : text === '\n' ? 'insertLineBreak' : 'insertText';
      if (!element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType, data: deleting ? null : text }))) return;
      const replacement = deleting ? '' : text;
      let next = value.slice(0, start) + replacement + value.slice(end);
      if (element.maxLength >= 0 && next.length > element.maxLength) return;
      const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, next);
      try { element.setSelectionRange(start + replacement.length, start + replacement.length); } catch (_) {}
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType, data: deleting ? null : text }));
    }
    window.addEventListener('message', event => {
      const message = event.data;
      if (event.source !== parent || (parentOrigin && parentOrigin !== 'null' && event.origin !== parentOrigin) ||
          !message || message.source !== 'phone-preview-key' || message.token !== token) return;
      sync();
      if (message.fieldId !== fieldId || !editable(active) || active.inputMode === 'none') return;
      if (message.action === 'hide') { active.blur(); sync(); return; }
      if (message.action === 'backspace') edit('', true);
      else if (message.action === 'insert' && typeof message.text === 'string' && message.text.length <= 8) edit(message.text);
      else if (message.action === 'enter') {
        const element = active;
        const multiline = element.tagName === 'TEXTAREA' && (!element.enterKeyHint || element.enterKeyHint === 'enter');
        const accepted = element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true, cancelable: true }));
        if (multiline && accepted) edit('\n');
        element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true }));
        if (!multiline && element.enterKeyHint !== 'next' && element.enterKeyHint !== 'previous' && focusedElement() === element) element.blur();
      }
      sync();
    });
    sync();
  })();`;
}
//# sourceMappingURL=keyboardBridge.js.map