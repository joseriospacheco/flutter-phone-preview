/** Grants preview-local notification permission and relays notices to VS Code. */
export function getNotificationBridge(token: string): string {
  return String.raw`(() => {
    const token = ${JSON.stringify(token)};
    let parentOrigin = '*';
    try {
      const origin = new URL(document.referrer).origin;
      if (origin && origin !== 'null') parentOrigin = origin;
    } catch (_) {}
    let sequence = 0;
    const instances = new Map();

    function send(title, options, id) {
      const source = options && typeof options === 'object' ? options : {};
      try {
        parent.postMessage({
          source: 'phone-preview-notification', token, id,
          title: String(title == null ? '' : title).slice(0, 200),
          body: String(source.body == null ? '' : source.body).slice(0, 2000),
          tag: String(source.tag == null ? '' : source.tag).slice(0, 200),
          silent: source.silent === true
        }, parentOrigin);
      } catch (_) {}
    }

    class PreviewNotification extends EventTarget {
      constructor(title, options) {
        super();
        const source = options && typeof options === 'object' ? options : {};
        this.title = String(title == null ? '' : title);
        this.body = String(source.body == null ? '' : source.body);
        this.tag = String(source.tag == null ? '' : source.tag);
        this.icon = String(source.icon == null ? '' : source.icon);
        this.badge = String(source.badge == null ? '' : source.badge);
        this.image = String(source.image == null ? '' : source.image);
        this.data = source.data == null ? null : source.data;
        this.dir = source.dir || 'auto';
        this.lang = source.lang || '';
        this.timestamp = Number.isFinite(source.timestamp) ? source.timestamp : Date.now();
        this.requireInteraction = source.requireInteraction === true;
        this.silent = source.silent == null ? null : source.silent === true;
        this.onclick = null;
        this.onclose = null;
        this.onerror = null;
        this.onshow = null;
        this.__previewId = ++sequence;
        instances.set(this.__previewId, this);
        send(this.title, source, this.__previewId);
        queueMicrotask(() => {
          const event = new Event('show');
          this.dispatchEvent(event);
          if (typeof this.onshow === 'function') this.onshow.call(this, event);
        });
      }
      close() {
        if (!instances.delete(this.__previewId)) return;
        const event = new Event('close');
        this.dispatchEvent(event);
        if (typeof this.onclose === 'function') this.onclose.call(this, event);
      }
    }
    Object.defineProperties(PreviewNotification, {
      permission: { enumerable: true, configurable: false, get: () => 'granted' },
      maxActions: { enumerable: true, configurable: false, get: () => 0 }
    });
    PreviewNotification.requestPermission = callback => {
      const result = Promise.resolve('granted');
      if (typeof callback === 'function') result.then(callback);
      return result;
    };

    try {
      Object.defineProperty(window, 'Notification', {
        configurable: true, writable: true, value: PreviewNotification
      });
    } catch (_) { try { window.Notification = PreviewNotification; } catch (_) {} }

    try {
      const registration = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
      if (registration) {
        Object.defineProperty(registration, 'showNotification', {
          configurable: true, writable: true,
          value: function(title, options) { send(title, options, 0); return Promise.resolve(); }
        });
      }
    } catch (_) {}

    try {
      const permissions = navigator.permissions;
      if (permissions && typeof permissions.query === 'function') {
        const nativeQuery = permissions.query.bind(permissions);
        permissions.query = descriptor => {
          if (descriptor && descriptor.name === 'notifications') {
            const status = new EventTarget();
            Object.defineProperties(status, {
              state: { enumerable: true, get: () => 'granted' },
              onchange: { configurable: true, enumerable: true, writable: true, value: null }
            });
            return Promise.resolve(status);
          }
          return nativeQuery(descriptor);
        };
      }
    } catch (_) {}

    window.addEventListener('message', event => {
      const message = event.data;
      if (event.source !== parent || !message || message.command !== 'notificationClicked' || message.token !== token) return;
      const instance = instances.get(Number(message.id));
      if (!instance) return;
      const click = new Event('click');
      instance.dispatchEvent(click);
      if (typeof instance.onclick === 'function') instance.onclick.call(instance, click);
    });
  })();`;
}
