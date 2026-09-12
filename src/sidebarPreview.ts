import type * as vscode from 'vscode';

export interface PreviewSession {
  url: string;
  device: string;
  token: string;
}

interface SidebarCallbacks {
  renderPreview(session: PreviewSession): string;
  renderIdle(starting: boolean): string;
  onStart(): void;
  showView(): void | Thenable<unknown>;
  onMessage(message: any, session: PreviewSession): void;
}

/** Owns the view document; Flutter and its proxy outlive sidebar visibility. */
export class PhonePreviewViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'flutterPhonePreview.view';
  private view?: vscode.WebviewView;
  private viewListeners: vscode.Disposable[] = [];
  private session?: PreviewSession;
  private starting = false;
  private ready = false;
  private reloadPending = false;

  constructor(private readonly callbacks: SidebarCallbacks) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.releaseView();
    this.view = view;
    view.webview.options = { enableScripts: true };
    this.viewListeners.push(
      view.webview.onDidReceiveMessage(message => {
        if (this.view !== view || !message || typeof message !== 'object') return;
        if (message.command === 'startPreview') {
          if (!this.session && !this.starting) this.callbacks.onStart();
          return;
        }
        const session = this.session;
        if (!session) return;
        if (message.command === 'webviewReady') {
          if (message.token !== session.token || this.ready) return;
          this.ready = true;
          this.reloadPending = false;
          void view.webview.postMessage({ command: 'loadApp', url: session.url });
          return;
        }
        this.callbacks.onMessage(message, session);
      }),
      view.onDidChangeVisibility(() => {
        if (this.view === view && view.visible && this.ready && this.reloadPending) {
          this.reload();
        }
      }),
      view.onDidDispose(() => {
        if (this.view === view) this.releaseView();
      })
    );
    this.render();
  }

  async show(): Promise<void> {
    if (this.view) {
      this.view.show(true);
    } else {
      await this.callbacks.showView();
    }
  }

  setPreview(session: PreviewSession): void {
    this.session = session;
    this.starting = false;
    this.reloadPending = false;
    this.render();
  }

  setStarting(): void {
    this.session = undefined;
    this.starting = true;
    this.reloadPending = false;
    this.render();
  }

  clear(): void {
    this.session = undefined;
    this.starting = false;
    this.reloadPending = false;
    this.render();
  }

  reload(): void {
    if (!this.session) return;
    if (!this.view?.visible || !this.ready) {
      this.reloadPending = true;
      return;
    }
    this.reloadPending = false;
    void this.view.webview.postMessage({ command: 'forceReload' });
  }

  private render(): void {
    this.ready = false;
    if (!this.view) return;
    this.view.webview.html = this.session
      ? this.callbacks.renderPreview(this.session)
      : this.callbacks.renderIdle(this.starting);
  }

  private releaseView(): void {
    this.view = undefined;
    this.ready = false;
    for (const listener of this.viewListeners.splice(0)) listener.dispose();
  }

  dispose(): void {
    this.releaseView();
    this.session = undefined;
    this.reloadPending = false;
  }
}
