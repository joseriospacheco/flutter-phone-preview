import * as vscode from 'vscode';
import * as http from 'http';
import * as net from 'net';
import { PreviewProxy, startPreviewProxy } from './previewProxy';
import { keyboardStyles, keyboardMarkup, getVirtualKeyboardScript } from './virtualKeyboard';
import { spawn, execFile, execFileSync, ChildProcessWithoutNullStreams } from 'child_process';

let flutterProcess: ChildProcessWithoutNullStreams | undefined;
let panel: vscode.WebviewPanel | undefined;
let previewProxy: PreviewProxy | undefined;
let outputChannel: vscode.OutputChannel;
let saveListener: vscode.Disposable | undefined;
  let pendingRebuild = false;
  let fallbackTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Flutter Phone Preview');

  context.subscriptions.push(
    vscode.commands.registerCommand('flutterPhonePreview.start', () => startFlutter(context)),
    vscode.commands.registerCommand('flutterPhonePreview.stop', () => stopFlutter()),
    vscode.commands.registerCommand('flutterPhonePreview.hotReload', () => sendToFlutter('r', 'Hot reload')),
    vscode.commands.registerCommand('flutterPhonePreview.hotRestart', () => sendToFlutter('R', 'Hot restart')),
    outputChannel
  );
}

function getWorkspaceFolder(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage('Abre una carpeta con un proyecto Flutter primero.');
    return undefined;
  }
  return folders[0].uri.fsPath;
}

function httpStatus(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      res.on('end', () => {
        const type = String(res.headers['content-type'] || '');
        resolve(/javascript|ecmascript/.test(type) ? res.statusCode : undefined);
      });
      res.on('error', () => resolve(undefined));
    });
    req.on('error', () => resolve(undefined));
    req.setTimeout(120000, () => {
      req.destroy();
      resolve(undefined);
    });
  });
}

// Espera a que el dev-server sirva la app compilada, no solo el socket abierto.
// Durante la (primera) compilación los assets JS aún devuelven 404 o el puerto
// rechaza la conexión; abrir el panel antes deja el iframe en blanco.
// Se exige `main.dart.js` (emitido al final del build): `flutter_bootstrap.js`
// puede responder 200 antes de que el entrypoint exista, y ese era el caso
// que dejaba la pantalla en blanco en el primer arranque.
// Inicia la compilación del dev-server (compile perezoso) pidiendo la página
// principal y su bootstrap, y devuelve true cuando main.dart.js existe.
async function waitForAppReady(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  // `flutter run -d web-server` compila bajo demanda: la primera petición
  // dispara el build. Sin este "warm-up", el panel se abriría contra un
  // servidor aún compilando y la primera carga saldría en blanco.
  http.get(`${baseUrl}/?warmup=${Date.now()}`, (res) => res.resume()).on('error', () => {});
  http.get(`${baseUrl}/flutter_bootstrap.js`, (res) => res.resume()).on('error', () => {});

  const entrypoint = `${baseUrl}/main.dart.js`;
  while (Date.now() < deadline) {
    const status = await httpStatus(entrypoint);
    if (status !== undefined && status < 400) {
      return true;
    }
    if (!flutterProcess) {
      return false; // detenido mientras esperábamos
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

// En Windows el proceso se lanza con `shell: true`; un simple `kill()` solo
// mata el cmd intermedio y deja huérfanos a flutter/dart (que siguen ocupando
// el puerto). Por eso hay que matar el árbol completo.
function killFlutterProcess() {
  if (!flutterProcess) {
    return;
  }
  const pid = flutterProcess.pid;
  if (process.platform === 'win32' && pid !== undefined) {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // ya estaba muerto o sin permiso
    }
  }
  try {
    flutterProcess.kill();
  } catch {
    // ya estaba muerto
  }
  flutterProcess = undefined;
}

// Versión síncrona para el apagado: `deactivate()` debe dejar el puerto libre
// ANTES de retornar, porque VS Code no espera a los `execFile` asíncronos al
// cerrar la ventana (esa era la fuente de huérfanos al salir de VS Code).
function killProcessTreeSync(): void {
  if (!flutterProcess) {
    return;
  }
  const pid = flutterProcess.pid;
  if (process.platform === 'win32' && pid !== undefined) {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // ya estaba muerto o sin permiso; seguimos con el kill normal
    }
  }
  try {
    flutterProcess.kill();
  } catch {
    // ya estaba muerto
  }
  flutterProcess = undefined;
}

function execFileAsync(file: string, args: string[]): Promise<string> {  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (_err, stdout, _stderr) => resolve(String(stdout || '')));
  });
}

// Comprueba si el puerto ya está ocupado antes de lanzar flutter,
// para fallar rápido con un mensaje claro en vez de un stack trace.
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// Libera el puerto matando al proceso que lo ocupa, pero SOLO si parece un
// resto de flutter/dart/node. Si lo ocupa otro programa, no lo toca.
async function freePort(port: number): Promise<string> {
  if (process.platform !== 'win32') {
    return 'Liberación automática solo disponible en Windows; libera el puerto manualmente.';
  }
  const out = await execFileAsync('cmd', ['/c', `netstat -ano | findstr LISTENING | findstr :${port}`]);
  const m = out.match(/LISTENING\s+(\d+)/);
  if (!m) {
    return `Ya no hay ningún proceso escuchando en el puerto ${port}. Reintenta iniciar.`;
  }
  const pid = m[1];
  const tl = await execFileAsync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
  const name = (tl.split(',')[0] || '').replace(/"/g, '').trim();
  if (!/dart|flutter|node/i.test(name)) {
    return `El puerto ${port} lo ocupa "${name || 'un programa desconocido'}" (PID ${pid}); no lo mato automáticamente. Ciérralo manualmente o cambia el puerto en "flutterPhonePreview.port".`;
  }
  await execFileAsync('taskkill', ['/pid', pid, '/T', '/F']);
  return `Proceso ${name} (PID ${pid}) terminado; puerto ${port} liberado.`;
}

// Devuelve true si el puerto quedó libre (ya lo estaba o se liberó con el botón).
async function ensurePortFree(port: number): Promise<boolean> {
  if (!(await isPortInUse(port))) {
    return true;
  }
  const choice = await vscode.window.showErrorMessage(
    `El puerto ${port} ya está en uso (probablemente quedó un "flutter run" anterior).`,
    'Liberar puerto e iniciar',
    'Detener vista previa',
    'Cambiar puerto'
  );
  if (choice === 'Liberar puerto e iniciar') {
    const result = await freePort(port);
    if (await isPortInUse(port)) {
      vscode.window.showErrorMessage(result);
      return false;
    }
    vscode.window.showInformationMessage(result);
    return true;
  }
  if (choice === 'Detener vista previa') {
    await vscode.commands.executeCommand('flutterPhonePreview.stop');
    return false;
  }
  if (choice === 'Cambiar puerto') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'flutterPhonePreview.port');
    return false;
  }
  return false;
}

async function startFlutter(context: vscode.ExtensionContext) {
  if (flutterProcess) {
    vscode.window.showInformationMessage('Flutter ya se está ejecutando.');
    if (panel) {
      panel.reveal();
    }
    return;
  }

  const cwd = getWorkspaceFolder();
  if (!cwd) {
    return;
  }

  const config = vscode.workspace.getConfiguration('flutterPhonePreview');
  const port = config.get<number>('port', 5001);
  const device = config.get<string>('device', 'iphone15');
  const autoReloadOnSave = config.get<boolean>('autoReloadOnSave', true);

    // Activa los Preview Editors antes de crear el WebviewPanel cuando el
    // perfil de VS Code los tiene desactivados.
    const editorConfig = vscode.workspace.getConfiguration('workbench.editor');
    if (editorConfig.get('enablePreview') === false) {
        try {
            await editorConfig.update('enablePreview', true, vscode.ConfigurationTarget.Global);
        }
        catch {
            outputChannel.appendLine('No se pudo activar workbench.editor.enablePreview automáticamente.');
        }
    }
  if (!(await ensurePortFree(port))) {
    return;
  }

  outputChannel.show(true);
  outputChannel.appendLine(`Iniciando: flutter run -d web-server --web-port ${port}`);

  flutterProcess = spawn('flutter', ['run', '-d', 'web-server', '--web-port', String(port)], {
    cwd,
    shell: true
  });

  let opened = false;
  let failed = false;
  let waiting = false;
  let serverAnnounced = false;
  let startupOutput = '';
  const startingProcess = flutterProcess;
  const baseUrl = `http://localhost:${port}`;

  // Abre el panel solo cuando la app ya está compilada y servida.
  // Antes se abría al ver "is being served at", pero en ese momento el
  // servidor aún está compilando y el iframe quedaba en blanco hasta
  // pulsar Recargar manualmente.
  function requestOpen() {
    if (opened || waiting || failed || !serverAnnounced || flutterProcess !== startingProcess) {
      return;
    }
    waiting = true;
    outputChannel.appendLine('Servidor detectado, esperando a que la app termine de compilar...');
    waitForAppReady(baseUrl, 120000).then((ready) => {
      waiting = false;
      if (flutterProcess !== startingProcess || failed) {
        return; // se detuvo mientras esperábamos
      }
      if (!ready) {
        vscode.window.showWarningMessage(
          `Flutter anunció el servidor, pero no terminó de servir la app en ${baseUrl}. Revisa la salida y vuelve a iniciar la vista previa.`
        );
        return;
      } else {
        outputChannel.appendLine('App compilada, abriendo panel…');
      }
      if (!opened) {
        opened = true;
        openPhonePanel(context, baseUrl, device).catch((error: Error) => {
          opened = false;
          vscode.window.showErrorMessage(`No se pudo abrir la vista previa: ${error.message}`);
        });
      }
    });
  }

  flutterProcess.stdout.on('data', (data: Buffer) => {
    const text = data.toString();
    outputChannel.append(text);

    // El puerto ya está ocupado (p. ej. quedó un `flutter run` anterior colgado).
    if (/Failed to bind|Address already in use|errno = 10048/i.test(text)) {
      failed = true;
      vscode.window.showErrorMessage(
        `El puerto ${port} ya está en uso. Ejecuta "Flutter: Detener vista previa en teléfono" para matar la instancia anterior, libera el puerto manualmente, o cambia el puerto en la configuración "flutterPhonePreview.port".`
      );
    }

    if (!serverAnnounced) {
      startupOutput = (startupOutput + text).slice(-8192);
      if (/is being served at\s+http:\/\//i.test(startupOutput)) {
        serverAnnounced = true;
        clearFallbackTimer();
        requestOpen();
      }
    }

    // Cuando Flutter termina de recompilar (hot reload/restart), forzamos
    // una recarga completa del iframe: es la forma confiable de ver los
    // cambios, ya que el panel no tiene una conexión de depurador real.
    if (
      pendingRebuild &&
      /Reloaded \d+ .* in \d|Restarted application in \d|Application finished/i.test(text)
    ) {
      pendingRebuild = false;
      refreshPanelFrame();
    }

    if (/Failed to compile|Error:/i.test(text)) {
      pendingRebuild = false;
    }
  });

  flutterProcess.stderr.on('data', (data: Buffer) => {
    outputChannel.append(data.toString());
  });

  flutterProcess.on('close', (code) => {
    outputChannel.appendLine(`\nFlutter finalizó con código ${code}`);
    flutterProcess = undefined;
    disposeSaveListener();
    clearFallbackTimer();
    if (code !== 0 && !opened && !failed) {
      vscode.window.showErrorMessage(`Flutter no pudo iniciar (código ${code}). Revisa el canal de salida "Flutter Phone Preview".`);
    }
  });

  flutterProcess.on('error', (err) => {
    vscode.window.showErrorMessage(`No se pudo iniciar flutter: ${err.message}`);
    flutterProcess = undefined;
    disposeSaveListener();
    clearFallbackTimer();
  });

  // Una compilación lenta no autoriza abrir el iframe antes del servidor.
  // Avisamos si falta la señal, pero no interrumpimos el proceso.
  clearFallbackTimer();
  fallbackTimer = setTimeout(() => {
    if (flutterProcess === startingProcess && !serverAnnounced && !failed) {
      vscode.window.showWarningMessage('Flutter aún no anunció que la app esté disponible. Revisa el canal Flutter Phone Preview.');
    }
  }, 180000);

  if (autoReloadOnSave) {
    disposeSaveListener();
    saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === 'dart' && flutterProcess) {
        sendToFlutter('r', 'Hot reload (auto al guardar)');
      }
    });
    context.subscriptions.push(saveListener);
  }
}

function disposeSaveListener() {
  if (saveListener) {
    saveListener.dispose();
    saveListener = undefined;
  }
}

function clearFallbackTimer() {
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = undefined;
  }
}

function stopFlutter() {
  previewProxy?.dispose();
  previewProxy = undefined;
  clearFallbackTimer();
  if (flutterProcess) {
    killFlutterProcess();
    vscode.window.showInformationMessage('Flutter detenido.');
  }
  disposeSaveListener();
  if (panel) {
    panel.dispose();
  }
}

function sendToFlutter(key: string, label: string) {
  if (flutterProcess && flutterProcess.stdin) {
    pendingRebuild = true;
    flutterProcess.stdin.write(key);
    outputChannel.appendLine(`\n> ${label} enviado, esperando recompilación...`);
  } else {
    vscode.window.showWarningMessage('Flutter no se está ejecutando.');
  }
}

function refreshPanelFrame() {
  if (panel) {
    panel.webview.postMessage({ command: 'forceReload' });
  }
}

async function openPhonePanel(context: vscode.ExtensionContext, url: string, device: string) {
  const enableRestProxy = vscode.workspace.getConfiguration('flutterPhonePreview').get<boolean>('enableRestProxy', true);
  const proxy = await startPreviewProxy(url, device, { enableRestProxy });
  outputChannel.appendLine(enableRestProxy
    ? 'Proxy REST activo: las solicitudes HTTP/HTTPS de la app se envían desde la extensión.'
    : 'Proxy REST desactivado: las solicitudes usan las reglas CORS del navegador.');
  if (!flutterProcess) { proxy.dispose(); return; }
  previewProxy?.dispose();
  previewProxy = proxy;
  url = proxy.url;
  panel = vscode.window.createWebviewPanel(
    'flutterPhonePreview',
    'Flutter — Vista de Teléfono',
    { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  // Espera a que el webview esté listo (JS ejecutado) antes de enviar el
  // mensaje que le dice que cargue el iframe. El receptor se registra antes
  // de asignar el HTML para no perder el aviso si el webview arranca rápido.
  const readyListener = panel.webview.onDidReceiveMessage(
    (msg) => {
      if (msg.command === 'webviewReady') {
        panel?.webview.postMessage({ command: 'loadApp', url });
      } else if (msg.command === 'previewTimeout') {
        outputChannel.appendLine('El iframe no terminó de cargar en 60 segundos. No se reinicia para no interrumpir Flutter.');
      }
      else if (msg.command === 'previewRuntimeError' && msg.token === proxy.token) {
            const kind = typeof msg.kind === 'string' ? msg.kind : 'runtime';
            const detail = typeof msg.message === 'string' ? msg.message : 'Error desconocido';
            outputChannel.appendLine(`[App ${kind}] ${detail}`);
            if (typeof msg.stack === 'string' && msg.stack.trim()) {
                outputChannel.appendLine(msg.stack);
            }
        }
        else if (msg.command === 'webviewRuntimeError') {
            const detail = typeof msg.message === 'string' ? msg.message : 'Error desconocido en el panel';
            outputChannel.appendLine(`[Panel] ${detail}`);
            if (typeof msg.stack === 'string' && msg.stack.trim()) {
                outputChannel.appendLine(msg.stack);
            }
        }
    },
    null,
    context.subscriptions
  );

  panel.webview.html = getWebviewHtml(url, device, proxy.token);
  panel.reveal(vscode.ViewColumn.Two, true);

  panel.onDidDispose(
    () => {
      readyListener.dispose();
      panel = undefined;
      stopFlutter();
    },
    null,
    context.subscriptions
  );
}

function getWebviewHtml(url: string, device: string, keyboardToken = ''): string {
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  ${keyboardStyles}
  * { box-sizing: border-box; }
  html, body {
    height: 100%;
    margin: 0;
    background: var(--vscode-editor-background, #181b22);
    color: var(--vscode-foreground, #dbe2ec);
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    font-size: 12px;
    overflow: hidden;
  }
  body {
    --line: var(--vscode-panel-border, #343b49);
    --muted: var(--vscode-descriptionForeground, #a1adbd);
    --surface: var(--vscode-editorWidget-background, #20252f);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  button, select { font: inherit; }
  button:focus-visible, select:focus-visible {
    outline: 2px solid var(--vscode-focusBorder, #58c4f4);
    outline-offset: 3px;
  }
  .icon {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex-shrink: 0;
  }
  .toolbar {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    z-index: 10;
    flex-wrap: wrap;
    padding: 8px 18px;
    border-bottom: 1px solid var(--line);
  }
  .device-picker { flex: 1 1 180px; min-width: 0; }
  .field-label {
    display: block;
    margin-bottom: 4px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }
  .select-wrap { position: relative; }
  .select-wrap > .icon {
    position: absolute;
    right: 10px;
    top: 6px;
    pointer-events: none;
    color: var(--muted);
  }
  .toolbar select {
    appearance: none;
    width: 100%;
    height: 28px;
    min-width: 0;
    padding: 0 32px 0 11px;
    border: 1px solid var(--vscode-dropdown-border, var(--line));
    border-radius: 7px;
    background: var(--vscode-dropdown-background, #20252f);
    color: var(--vscode-dropdown-foreground, #dbe2ec);
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .view-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .toolbar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--surface);
    color: var(--vscode-foreground, #dbe2ec);
    cursor: pointer;
    white-space: nowrap;
  }
  .toolbar button:hover {
    background: var(--vscode-toolbar-hoverBackground, #303949);
  }
  .toolbar button:active { filter: brightness(0.95); }
  .toolbar button[aria-pressed="true"] {
    color: var(--vscode-inputOption-activeForeground, #ffffff);
    background: var(--vscode-inputOption-activeBackground, #264b69);
    border-color: var(--vscode-inputOption-activeBorder, #58c4f4);
  }
  .toolbar .primary {
    background: var(--vscode-button-background, #087ca7);
    color: var(--vscode-button-foreground, #ffffff);
    border-color: transparent;
  }
  .toolbar .primary:hover {
    background: var(--vscode-button-hoverBackground, #0990bc);
  }
  .zoom-group {
    display: flex;
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 7px;
    flex-shrink: 0;
  }
  .toolbar .zoom-group button {
    height: 26px;
    padding: 0 7px;
    border: 0;
    background: transparent;
  }
  .toolbar .zoom-group button:hover { background: var(--vscode-toolbar-hoverBackground, #303949); }
  #zoomLabel {
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    min-width: 32px;
    text-align: center;
  }
  .stage {
    display: flex;
    min-width: 0;
    min-height: 0;
    padding: 28px;
    overflow: auto;
    background-color: var(--vscode-sideBar-background, #14171d);
    background-image: radial-gradient(circle, var(--vscode-editorIndentGuide-background1, #303642) 0.7px, transparent 0.9px);
    background-size: 18px 18px;
    scrollbar-width: thin;
    scrollbar-color: var(--vscode-scrollbarSlider-background, #444c59) transparent;
  }
  .phone-viewport {
    position: relative;
    margin: auto;
    flex: 0 0 auto;
  }
  .preview-footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 14px;
    padding: 10px 18px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .preview-status { display: inline-flex; align-items: center; gap: 6px; }
  .status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .preview-status[data-state="loading"] { color: var(--vscode-textLink-foreground, #58c4f4); }
  .preview-status[data-state="slow"] { color: var(--vscode-editorWarning-foreground, #e9b35e); }
  .preview-status[data-state="error"] { color: var(--vscode-errorForeground, #f48771); }
  .zoom-hint { margin-left: auto; }
  @media (max-width: 620px) {
    .device-picker { flex-basis: 100%; }
    .view-actions { width: 100%; }
    .toolbar .primary { margin-left: auto; }
    .zoom-hint { display: none; }
  }
  @media (max-width: 400px) {
    .toolbar { padding: 8px 12px; gap: 6px; }
    .btn-text { display: none; }
    .stage { padding: 18px; }
    .preview-footer { padding: 9px 12px; }
    .toolbar button { padding: 0 8px; }
  }
  @media (max-height: 480px) {
    .toolbar { padding-top: 8px; padding-bottom: 8px; }
    .field-label { display: none; }
    .stage { padding: 14px; }
  }
  body.vscode-high-contrast .stage, body.vscode-high-contrast-light .stage { background-image: none; }
  body.vscode-high-contrast button, body.vscode-high-contrast-light button {
    border-color: var(--vscode-contrastBorder, currentColor);
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: none !important; }
  }
  .phone {
    background: #111111;
    padding: 10px;
    box-shadow: 0 0 0 1px #50545c, 0 2px 4px rgba(0, 0, 0, 0.3), 0 18px 40px -12px rgba(0, 0, 0, 0.5);
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    transform-origin: top left;
  }
  .notch {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    height: 22px;
    background: #111111;
    border-bottom-left-radius: 14px;
    border-bottom-right-radius: 14px;
    z-index: 2;
    display: none;
  }
  .punch {
    position: absolute;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #111111;
    border: 2px solid #333;
    z-index: 2;
    display: none;
  }
  .homebtn {
    position: absolute;
    bottom: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 2px solid #444;
    z-index: 2;
    display: none;
  }
  .screen {
    width: 100%;
    height: 100%;
    background: #F5FBF7;
    overflow: hidden;
    position: relative;
  }
  iframe {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    border: none;
    background: #ffffff;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: var(--vscode-editor-background, #181b22);
    color: var(--vscode-foreground, #dbe2ec);
    font-size: 13px;
    z-index: 5;
  }
  .loading-detail { color: var(--muted); font-size: 11px; }
  .loading.hidden {
    display: none;
  }
  .preview-error {
    position: absolute;
    inset: 0;
    z-index: 7;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    background: var(--vscode-editor-background, #181b22);
    color: var(--vscode-foreground, #dbe2ec);
  }
  .preview-error[hidden] { display: none; }
  .preview-error-title {
    color: var(--vscode-errorForeground, #f48771);
    font-size: 14px;
    font-weight: 600;
  }
  .preview-error-text {
    max-height: 45%;
    margin: 0;
    padding: 10px;
    overflow: auto;
    border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    border-radius: 6px;
    background: var(--vscode-textCodeBlock-background, #252526);
    color: var(--vscode-foreground, #dbe2ec);
    font: 11px/1.45 var(--vscode-editor-font-family, Consolas, monospace);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .preview-error-actions {
    display: flex;
    gap: 8px;
  }
  .preview-error-actions button {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--vscode-button-background, #087ca7);
    color: var(--vscode-button-foreground, #ffffff);
    cursor: pointer;
  }
  .preview-error-actions button:hover {
    background: var(--vscode-button-hoverBackground, #0990bc);
  }
  .spinner {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 2px solid var(--line);
    border-top-color: var(--vscode-textLink-foreground, #58c4f4);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .statusbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px 0 20px;
    box-sizing: border-box;
    font-size: 12.5px;
    font-weight: 600;
    font-family: -apple-system, 'Segoe UI', sans-serif;
    color: #111111;
    pointer-events: none;
    z-index: 4;
  }
  .status-icons {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sig {
    display: flex;
    align-items: flex-end;
    gap: 1.5px;
    height: 12px;
  }
  .sig i {
    width: 3px;
    background: #111111;
    border-radius: 1px;
  }
  .sig i:nth-child(1) { height: 4px; }
  .sig i:nth-child(2) { height: 6px; }
  .sig i:nth-child(3) { height: 9px; }
  .sig i:nth-child(4) { height: 12px; }
  .wifi {
    width: 15px;
    height: 12px;
    fill: #111111;
  }
  .batt {
    width: 24px;
    height: 12px;
    border: 1.5px solid #111111;
    border-radius: 3.5px;
    position: relative;
    padding: 1.5px;
    box-sizing: border-box;
  }
  .batt::after {
    content: '';
    position: absolute;
    right: -4.5px;
    top: 50%;
    transform: translateY(-50%);
    width: 2.5px;
    height: 5px;
    background: #111111;
    border-radius: 0 2px 2px 0;
  }
  .batt-fill {
    display: block;
    height: 100%;
    width: 80%;
    background: #111111;
    border-radius: 1.5px;
  }
</style>
</head>
<body>
  <section class="toolbar" aria-label="Controles de la vista previa">
    <div class="device-picker">
      <label class="field-label" for="deviceSelect">Dispositivo</label>
      <div class="select-wrap">
        <select id="deviceSelect" title="Modelo de teléfono"></select>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
      </div>
    </div>
    <div class="view-actions">
      <div class="zoom-group" role="group" aria-label="Zoom">
        <button id="zoomOut" title="Alejar" aria-label="Alejar"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button>
        <button id="zoomResetBtn" title="Restablecer zoom" aria-label="Restablecer zoom"><span id="zoomLabel">100%</span></button>
        <button id="zoomIn" title="Acercar" aria-label="Acercar"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg></button>
      </div>
      <button id="fitBtn" title="Ajustar a la pantalla" aria-label="Ajustar a la pantalla"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg><span class="btn-text">Ajustar</span></button>
      <button id="rotateBtn" title="Rotar (vertical / horizontal)" aria-label="Rotar pantalla" aria-pressed="false"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="6" width="8" height="12" rx="2" transform="rotate(30 12 12)"/><path d="M4 9a9 9 0 0 1 14-5l2 2m0-4v4h-4M20 15a9 9 0 0 1-14 5l-2-2m0 4v-4h4"/></svg><span class="btn-text">Rotar</span></button>
      <button id="reloadBtn" class="primary" title="Recargar app" aria-label="Recargar app"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9"/></svg><span>Recargar</span></button>
    </div>
  </section>
  <main class="stage" id="stage" aria-label="Vista previa de la app">
    <div class="phone-viewport" id="phoneViewport">
    <div class="phone" id="phone">
      <div class="notch" id="notchEl"></div>
      <div class="punch" id="punchEl"></div>
      <div class="homebtn" id="homeBtnEl"></div>
      <div class="screen">
        <iframe id="preview" title="Aplicación Flutter" data-url="${url}"></iframe>
        ${keyboardMarkup}
        <div class="statusbar" id="statusBar" aria-hidden="true">
          <span id="clockEl">--:--</span>
          <span class="status-icons">
            <span class="sig"><i></i><i></i><i></i><i></i></span>
            <svg class="wifi" viewBox="0 0 16 13"><path d="M8 10.4c.7 0 1.2.5 1.2 1.2S8.7 12.8 8 12.8s-1.2-.5-1.2-1.2.5-1.2 1.2-1.2zM8 6.8c1.7 0 3.2.7 4.3 1.8l-1.5 1.5C10 9.3 9.1 8.8 8 8.8s-2 .5-2.8 1.3L3.7 8.6C4.8 7.5 6.3 6.8 8 6.8zM8 3c2.8 0 5.3 1.1 7.1 2.9l-1.5 1.5C12.3 6.1 10.3 5.3 8 5.3S3.7 6.1 2.4 7.4L.9 5.9C2.7 4.1 5.2 3 8 3z"/></svg>
            <span class="batt"><span class="batt-fill" id="battFill"></span></span>
          </span>
        </div>
        <div class="loading" id="loadingEl"><div class="spinner" aria-hidden="true"></div><span id="loadingText">Cargando app…</span><span class="loading-detail">Preparando tu vista previa</span></div>
        <div class="preview-error" id="previewError" role="alert" hidden>
          <div class="preview-error-title">La aplicación encontró un error</div>
          <pre class="preview-error-text" id="previewErrorText">No se pudo obtener más información.</pre>
          <div class="preview-error-actions">
            <button type="button" id="previewErrorReload">Recargar app</button>
          </div>
        </div>
      </div>
    </div>
    </div>
  </main>
  <footer class="preview-footer">
    <span class="preview-status" id="previewStatus" data-state="loading" role="status"><span class="status-dot" aria-hidden="true"></span><span id="statusText">Preparando vista</span></span>
    <span id="deviceDetails"></span>
    <span class="zoom-hint">Ctrl + rueda para zoom</span>
  </footer>
  <script>
    const vscode = acquireVsCodeApi();
    window.addEventListener('error', event => {
      vscode.postMessage({
        command: 'webviewRuntimeError',
        message: event.message || 'Error desconocido en el panel',
        stack: event.error && event.error.stack ? event.error.stack : ''
      });
    });
    window.addEventListener('unhandledrejection', event => {
      const reason = event.reason;
      vscode.postMessage({
        command: 'webviewRuntimeError',
        message: reason && reason.message ? reason.message : String(reason || 'Promesa rechazada'),
        stack: reason && reason.stack ? reason.stack : ''
      });
    });
    const DEVICES = [
      { id: 'iphone15', name: 'iPhone 15 Pro', width: 393, height: 852, radius: 52, notchType: 'island', notchWidth: 120, inset: 44, frame: '#111111' },
      { id: 'iphone_16_pro_max', name: 'iPhone 16 Pro Max', width: 440, height: 956, radius: 56, notchType: 'island', notchWidth: 125, inset: 46, frame: '#111111' },
      { id: 'iphone_14', name: 'iPhone 14', width: 390, height: 844, radius: 48, notchType: 'island', notchWidth: 200, inset: 46, frame: '#0e0e0e' },
      { id: 'iphone_se', name: 'iPhone SE', width: 375, height: 667, radius: 36, notchType: 'home', inset: 32, frame: '#0e0e0e' },
      { id: 'pixel7', name: 'Google Pixel 7', width: 412, height: 915, radius: 30, notchType: 'punch', inset: 38, frame: '#1b1b1b' },
      { id: 'pixel8', name: 'Google Pixel 8', width: 412, height: 915, radius: 32, notchType: 'punch', inset: 38, frame: '#1b1b1b' },
      { id: 'galaxy_s22', name: 'Samsung Galaxy S22', width: 360, height: 780, radius: 26, notchType: 'punch', inset: 36, frame: '#151515' },
      { id: 'galaxy_s24_ultra', name: 'Samsung Galaxy S24 Ultra', width: 384, height: 896, radius: 28, notchType: 'punch', inset: 38, frame: '#131313' },
      { id: 'galaxy_a54', name: 'Samsung Galaxy A54', width: 393, height: 851, radius: 28, notchType: 'punch', inset: 38, frame: '#151515' },
      { id: 'xiaomi_redmi_note13', name: 'Xiaomi Redmi Note 13', width: 393, height: 851, radius: 30, notchType: 'punch', inset: 38, frame: '#111111' },
      { id: 'oneplus_12', name: 'OnePlus 12', width: 412, height: 915, radius: 32, notchType: 'punch', inset: 38, frame: '#151515' },
      { id: 'moto_edge', name: 'Motorola Edge 40', width: 402, height: 874, radius: 32, notchType: 'punch', inset: 38, frame: '#1b1b1b' },
      { id: 'ipad_mini', name: 'iPad Mini (tablet)', width: 744, height: 1000, radius: 22, notchType: 'none', inset: 30, frame: '#1b1b1b' },
      { id: 'ipad_pro', name: 'iPad Pro 11" (tablet)', width: 834, height: 1194, radius: 24, notchType: 'none', inset: 30, frame: '#1b1b1b' }
    ];

    const initialDeviceId = ${JSON.stringify(device)};
    let currentDevice = DEVICES.find(d => d.id === initialDeviceId) || DEVICES[0];
    let zoom = 1;
    let rotated = false;

    const phone = document.getElementById('phone');
    const phoneViewport = document.getElementById('phoneViewport');
    const stage = document.getElementById('stage');
    const notchEl = document.getElementById('notchEl');
    const punchEl = document.getElementById('punchEl');
    const homeBtnEl = document.getElementById('homeBtnEl');
    const select = document.getElementById('deviceSelect');
    const zoomLabel = document.getElementById('zoomLabel');
    const preview = document.getElementById('preview');

    DEVICES.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      if (d.id === currentDevice.id) opt.selected = true;
      select.appendChild(opt);
    });

    function applyDevice() {
      const w = rotated ? currentDevice.height : currentDevice.width;
      const h = rotated ? currentDevice.width : currentDevice.height;

      phone.style.width = (w + 20) + 'px';
      phone.style.height = (h + 20) + 'px';
      phone.style.borderRadius = currentDevice.radius + 'px';
      phone.style.background = currentDevice.frame;
      phone.querySelector('.screen').style.borderRadius = Math.max(currentDevice.radius - 16, 8) + 'px';

      notchEl.style.display = (!rotated && currentDevice.notchType === 'island') ? 'block' : 'none';
      notchEl.style.width = (currentDevice.notchWidth || 120) + 'px';
      notchEl.style.background = currentDevice.frame;

      punchEl.style.display = (!rotated && currentDevice.notchType === 'punch') ? 'block' : 'none';
      punchEl.style.background = currentDevice.frame;

      homeBtnEl.style.display = (!rotated && currentDevice.notchType === 'home') ? 'block' : 'none';

      // Reserva el area superior y separa el contenido de la isla.
      const contentTop = (!rotated && currentDevice.notchType === 'island') ? 26 : currentDevice.inset;
      preview.style.top = contentTop + 'px';
      preview.style.height = 'calc(100% - ' + contentTop + 'px)';
      layoutKeyboard();

      document.getElementById('deviceDetails').textContent = w + ' × ' + h + ' · ' + (rotated ? 'Horizontal' : 'Vertical');
      document.getElementById('rotateBtn').setAttribute('aria-pressed', String(rotated));

      refit();
    }

    // Escala base para que el teléfono quepa en el panel (solo reduce, máx. 100%).
    // El zoom manual actúa como multiplicador sobre esta base.
    let fitZoom = 1;

    function phoneOuterSize() {
      const w = rotated ? currentDevice.height : currentDevice.width;
      const h = rotated ? currentDevice.width : currentDevice.height;
      return { w: w + 20, h: h + 20 };
    }

    function computeFit() {
      const s = phoneOuterSize();
      const stageStyle = getComputedStyle(stage);
      const availW = stage.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight);
      const availH = stage.clientHeight - parseFloat(stageStyle.paddingTop) - parseFloat(stageStyle.paddingBottom);
      if (availW <= 0 || availH <= 0) {
        return 1;
      }
      return Math.min(availW / s.w, availH / s.h, 1);
    }

    function applyZoom() {
      const scale = Math.min(Math.max(fitZoom * zoom, 0.1), 3);
      const size = phoneOuterSize();
      phoneViewport.style.width = (size.w * scale) + 'px';
      phoneViewport.style.height = (size.h * scale) + 'px';
      phone.style.transform = 'scale(' + scale + ')';
      zoomLabel.textContent = Math.round(scale * 100) + '%';
    }

    function refit() {
      fitZoom = computeFit();
      applyZoom();
    }

    select.addEventListener('change', (e) => {
      currentDevice = DEVICES.find(d => d.id === e.target.value) || DEVICES[0];
      applyDevice();
    });

    document.getElementById('zoomIn').addEventListener('click', () => {
      zoom = Math.min(zoom + 0.1, 2.5);
      applyZoom();
    });
    document.getElementById('zoomOut').addEventListener('click', () => {
      zoom = Math.max(zoom - 0.1, 0.3);
      applyZoom();
    });
    document.getElementById('zoomResetBtn').addEventListener('click', () => {
      zoom = 1;
      refit();
    });
    document.getElementById('fitBtn').addEventListener('click', () => {
      zoom = 1;
      refit();
    });
    document.getElementById('rotateBtn').addEventListener('click', () => {
      rotated = !rotated;
      applyDevice();
    });
    const loadingEl = document.getElementById('loadingEl');
    const loadingText = document.getElementById('loadingText');
    const previewError = document.getElementById('previewError');
    const previewErrorText = document.getElementById('previewErrorText');
    const baseUrl = preview.dataset.url;
    let loadTimer;
    let navigationId = 0;
    let navigationStarted = false;

    function setPreviewStatus(text, state) {
      document.getElementById('statusText').textContent = text;
      document.getElementById('previewStatus').dataset.state = state;
    }

    function hidePreviewError() {
      previewError.hidden = true;
    }

    function showPreviewError(kind, message, stack) {
      const detail = [message, stack].filter(value => typeof value === 'string' && value.trim()).join('\\n\\n');
      previewErrorText.textContent = detail || 'No se pudo obtener más información.';
      previewError.hidden = false;
      hideLoading();
      setPreviewStatus('Error en la app', 'error');
    }

    function hideLoading() {
      loadingEl.classList.add('hidden');
    }

    function loadApp(url = baseUrl) {
      resetKeyboard();
      hidePreviewError();
      clearTimeout(loadTimer);
      navigationStarted = true;
      navigationId++;
      setPreviewStatus('Cargando vista', 'loading');
      loadingText.textContent = 'Cargando app…';
      loadingEl.classList.remove('hidden');
      const target = new URL(url);
      target.searchParams.set('_previewDevice', currentDevice.id);
      target.searchParams.set('_preview', String(Date.now()) + '-' + navigationId);
      preview.src = target.href;
      // No reiniciar Flutter mientras compila o inicializa su motor.
      // El overlay tampoco debe ocultar indefinidamente una app ya dibujada.
      loadTimer = setTimeout(() => {
        hideLoading();
        setPreviewStatus('La carga está tardando', 'slow');
        vscode.postMessage({ command: 'previewTimeout' });
      }, 60000);
    }

    function forceReloadFrame() {
      loadApp();
    }

    document.getElementById('reloadBtn').addEventListener('click', () => loadApp());
    document.getElementById('previewErrorReload').addEventListener('click', () => loadApp());

    preview.addEventListener('load', () => {
      if (!navigationStarted) return;
      clearTimeout(loadTimer);
      // load solo confirma el documento: Flutter puede seguir arrancando.
      // Quitamos nuestra cubierta y dejamos que el motor termine sin recargas.
      hideLoading();
      setPreviewStatus('Vista abierta', 'ready');
    });
    preview.addEventListener('error', () => {
      showPreviewError('iframe', 'No se pudo cargar el documento de la aplicación.');
    });

    // Barra de estado: hora en vivo + iconos de señal, wifi y batería.
    // (La señal se muestra llena por ser una maqueta; la batería usa la
    // Battery API del equipo cuando está disponible, si no 80%.)
    const clockEl = document.getElementById('clockEl');
    function tickClock() {
      const d = new Date();
      clockEl.textContent =
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    tickClock();
    setInterval(tickClock, 10000);
    try {
      if (navigator.getBattery) {
        navigator.getBattery().then((b) => {
          const fill = document.getElementById('battFill');
          const update = () => {
            fill.style.width = Math.round(b.level * 100) + '%';
          };
          update();
          b.addEventListener('levelchange', update);
        }).catch(() => {});
      }
    } catch (e) {}

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;
      if (event.source === preview.contentWindow) {
        if (msg.source === 'phone-preview-runtime-error' && msg.token === ${JSON.stringify(keyboardToken)}) {
          showPreviewError(msg.kind || 'runtime', msg.message, msg.stack);
          vscode.postMessage({command: 'previewRuntimeError', token: msg.token, kind: msg.kind || 'runtime', message: msg.message || 'Error desconocido', stack: msg.stack || ''});
        }
        return;
      }
      if (msg.command === 'loadApp') loadApp(msg.url);
      else if (msg.command === 'forceReload') forceReloadFrame();
    });

    // Zoom con Ctrl + rueda del mouse sobre el escenario
    stage.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        zoom = Math.min(Math.max(zoom + (e.deltaY < 0 ? 0.1 : -0.1), 0.3), 2.5);
        applyZoom();
      }
    }, { passive: false });

    // Reajustar automáticamente al cambiar el tamaño del panel
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        fitZoom = computeFit();
        applyZoom();
      }).observe(stage);
    } else {
      window.addEventListener('resize', () => {
        fitZoom = computeFit();
        applyZoom();
      });
    }

    ${getVirtualKeyboardScript(keyboardToken)}
    applyDevice();

    // Avisa a la extensión que el JS del webview está listo y puede enviar
    // el mensaje 'loadApp' para cargar el iframe.
    vscode.postMessage({ command: 'webviewReady' });
  </script>
</body>
</html>`;
}

export function deactivate() {
  previewProxy?.dispose();
  previewProxy = undefined;
  clearFallbackTimer();
  disposeSaveListener();
  killProcessTreeSync();
  if (panel) {
    try {
      panel.dispose();
    } catch {
      // el panel ya estaba cerrado
    }
    panel = undefined;
  }
}
