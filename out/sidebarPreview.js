"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhonePreviewViewProvider = void 0;
/** Owns the view document; Flutter and its proxy outlive sidebar visibility. */
class PhonePreviewViewProvider {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.viewListeners = [];
        this.starting = false;
        this.ready = false;
        this.reloadPending = false;
    }
    resolveWebviewView(view) {
        this.releaseView();
        this.view = view;
        view.webview.options = { enableScripts: true };
        this.viewListeners.push(view.webview.onDidReceiveMessage(message => {
            if (this.view !== view || !message || typeof message !== 'object')
                return;
            if (message.command === 'startPreview') {
                if (!this.session && !this.starting)
                    this.callbacks.onStart();
                return;
            }
            const session = this.session;
            if (!session)
                return;
            if (message.command === 'webviewReady') {
                if (message.token !== session.token || this.ready)
                    return;
                this.ready = true;
                this.reloadPending = false;
                void view.webview.postMessage({ command: 'loadApp', url: session.url });
                return;
            }
            this.callbacks.onMessage(message, session);
        }), view.onDidChangeVisibility(() => {
            if (this.view === view && view.visible && this.ready && this.reloadPending) {
                this.reload();
            }
        }), view.onDidDispose(() => {
            if (this.view === view)
                this.releaseView();
        }));
        this.render();
    }
    async show() {
        if (this.view) {
            this.view.show(true);
        }
        else {
            await this.callbacks.showView();
        }
    }
    setPreview(session) {
        this.session = session;
        this.starting = false;
        this.reloadPending = false;
        this.render();
    }
    setStarting() {
        this.session = undefined;
        this.starting = true;
        this.reloadPending = false;
        this.render();
    }
    clear() {
        this.session = undefined;
        this.starting = false;
        this.reloadPending = false;
        this.render();
    }
    reload() {
        if (!this.session)
            return;
        if (!this.view?.visible || !this.ready) {
            this.reloadPending = true;
            return;
        }
        this.reloadPending = false;
        void this.view.webview.postMessage({ command: 'forceReload' });
    }
    render() {
        this.ready = false;
        if (!this.view)
            return;
        this.view.webview.html = this.session
            ? this.callbacks.renderPreview(this.session)
            : this.callbacks.renderIdle(this.starting);
    }
    releaseView() {
        this.view = undefined;
        this.ready = false;
        for (const listener of this.viewListeners.splice(0))
            listener.dispose();
    }
    dispose() {
        this.releaseView();
        this.session = undefined;
        this.reloadPending = false;
    }
}
exports.PhonePreviewViewProvider = PhonePreviewViewProvider;
PhonePreviewViewProvider.viewId = 'flutterPhonePreview.view';
//# sourceMappingURL=sidebarPreview.js.map