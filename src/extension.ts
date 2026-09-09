import * as vscode from 'vscode';
import * as http from 'http';
import * as net from 'net';
import { spawn, execFile, execFileSync, ChildProcessWithoutNullStreams } from 'child_process';

let flutterProcess: ChildProcessWithoutNullStreams | undefined;
let panel: vscode.WebviewPanel | undefined;
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
        openPhonePanel(context, baseUrl, device);
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

function openPhonePanel(context: vscode.ExtensionContext, url: string, device: string) {
  panel = vscode.window.createWebviewPanel(
    'flutterPhonePreview',
    'Flutter — Vista de Teléfono',
    vscode.ViewColumn.Beside,
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
    },
    null,
    context.subscriptions
  );

  panel.webview.html = getWebviewHtml(url, device);

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

function getWebviewHtml(url: string, device: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body {
    height: 100%;
    margin: 0;
    background: var(--vscode-editor-background, #1e1e1e);
    font-family: sans-serif;
    overflow: hidden;
  }
  .toolbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    z-index: 10;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 8px;
    box-sizing: border-box;
    scrollbar-width: thin;
    background: var(--vscode-editor-background, #1e1e1e);
  }
  .toolbar::-webkit-scrollbar {
    height: 4px;
  }
  .toolbar::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-background, #555);
    border-radius: 2px;
  }
  .toolbar select,
  .toolbar button {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #ffffff);
    border: none;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .toolbar select {
    background: var(--vscode-dropdown-background, #3c3c3c);
    color: var(--vscode-dropdown-foreground, #ffffff);
    flex-shrink: 1;
    min-width: 0;
    max-width: 160px;
    text-overflow: ellipsis;
    overflow: hidden;
  }
  .toolbar button:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }
  .zoom-group {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--vscode-editorWidget-background, #252526);
    padding: 2px 6px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .zoom-group button {
    padding: 4px 10px;
    font-weight: bold;
  }
  #zoomLabel {
    color: var(--vscode-foreground, #ccc);
    font-size: 12px;
    min-width: 42px;
    text-align: center;
    flex-shrink: 0;
  }
  .stage {
    height: 100vh;
    width: 100%;
    display: flex;
    padding: 46px 4px 4px;
    box-sizing: border-box;
    overflow: auto;
  }
  .stage .phone {
    margin: auto;
  }
  @media (max-width: 480px) {
    .toolbar {
      gap: 4px;
      padding: 6px;
    }
    .toolbar select,
    .toolbar button {
      font-size: 11px;
      padding: 5px 8px;
    }
    .toolbar select {
      max-width: 120px;
    }
    .zoom-group {
      gap: 2px;
      padding: 2px 4px;
    }
    .zoom-group button {
      padding: 3px 8px;
    }
    #zoomLabel {
      min-width: 34px;
      font-size: 11px;
    }
    .btn-text {
      display: none;
    }
    .stage {
      padding-top: 44px;
    }
  }
  @media (max-width: 340px) {
    #zoomResetBtn {
      display: none;
    }
    .toolbar select {
      max-width: 96px;
    }
  }
  .phone {
    background: #111111;
    padding: 10px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    position: relative;
    box-sizing: border-box;
    transition: width 0.15s ease, height 0.15s ease, border-radius 0.15s ease, transform 0.1s ease;
    flex-shrink: 0;
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
    background: #ffffff;
    color: #555555;
    font-size: 13px;
    z-index: 5;
  }
  .loading.hidden {
    display: none;
  }
  .spinner {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 3px solid #dddddd;
    border-top-color: #0e639c;
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
  <div class="toolbar">
    <select id="deviceSelect" title="Modelo de teléfono"></select>
    <div class="zoom-group">
      <button id="zoomOut" title="Alejar">−</button>
      <span id="zoomLabel">100%</span>
      <button id="zoomIn" title="Acercar">+</button>
      <button id="zoomResetBtn" title="Restablecer zoom">Reset</button>
    </div>
    <button id="rotateBtn" title="Rotar (vertical / horizontal)">⇄ <span class="btn-text">Rotar</span></button>
    <button id="reloadBtn" title="Recargar">↻ <span class="btn-text">Recargar</span></button>
    <button id="fitBtn" title="Ajustar a la pantalla">⤢ <span class="btn-text">Ajustar</span></button>
  </div>
  <div class="stage" id="stage">
    <div class="phone" id="phone">
      <div class="notch" id="notchEl"></div>
      <div class="punch" id="punchEl"></div>
      <div class="homebtn" id="homeBtnEl"></div>
      <div class="screen">
        <iframe id="preview" data-url="${url}"></iframe>
        <div class="statusbar" id="statusBar">
          <span id="clockEl">--:--</span>
          <span class="status-icons">
            <span class="sig"><i></i><i></i><i></i><i></i></span>
            <svg class="wifi" viewBox="0 0 16 13"><path d="M8 10.4c.7 0 1.2.5 1.2 1.2S8.7 12.8 8 12.8s-1.2-.5-1.2-1.2.5-1.2 1.2-1.2zM8 6.8c1.7 0 3.2.7 4.3 1.8l-1.5 1.5C10 9.3 9.1 8.8 8 8.8s-2 .5-2.8 1.3L3.7 8.6C4.8 7.5 6.3 6.8 8 6.8zM8 3c2.8 0 5.3 1.1 7.1 2.9l-1.5 1.5C12.3 6.1 10.3 5.3 8 5.3S3.7 6.1 2.4 7.4L.9 5.9C2.7 4.1 5.2 3 8 3z"/></svg>
            <span class="batt"><span class="batt-fill" id="battFill"></span></span>
          </span>
        </div>
        <div class="loading" id="loadingEl"><div class="spinner"></div><span id="loadingText">Cargando app…</span></div>
      </div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
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

      phone.style.width = (w + 28) + 'px';
      phone.style.height = (h + 28) + 'px';
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
      const availW = stage.clientWidth - 16;
      const availH = stage.clientHeight - 16;
      if (availW <= 0 || availH <= 0) {
        return 1;
      }
      return Math.min(availW / s.w, availH / s.h, 1);
    }

    function applyZoom() {
      const scale = Math.min(Math.max(fitZoom * zoom, 0.1), 3);
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
    const baseUrl = preview.dataset.url;
    let loadTimer;
    let navigationId = 0;
    let navigationStarted = false;

    function hideLoading() {
      loadingEl.classList.add('hidden');
    }

    function loadApp(url = baseUrl) {
      clearTimeout(loadTimer);
      navigationStarted = true;
      navigationId++;
      loadingText.textContent = 'Cargando app…';
      loadingEl.classList.remove('hidden');
      const target = new URL(url);
      target.searchParams.set('_preview', String(Date.now()) + '-' + navigationId);
      preview.src = target.href;
      // No reiniciar Flutter mientras compila o inicializa su motor.
      // El overlay tampoco debe ocultar indefinidamente una app ya dibujada.
      loadTimer = setTimeout(() => {
        hideLoading();
        vscode.postMessage({ command: 'previewTimeout' });
      }, 60000);
    }

    function forceReloadFrame() {
      loadApp();
    }

    document.getElementById('reloadBtn').addEventListener('click', () => loadApp());

    preview.addEventListener('load', () => {
      if (!navigationStarted) return;
      clearTimeout(loadTimer);
      // load solo confirma el documento: Flutter puede seguir arrancando.
      // Quitamos nuestra cubierta y dejamos que el motor termine sin recargas.
      hideLoading();
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
      if (!msg) { return; }
      if (msg.command === 'loadApp') {
        loadApp(msg.url);
      } else if (msg.command === 'forceReload') {
        forceReloadFrame();
      }
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

    applyDevice();

    // Avisa a la extensión que el JS del webview está listo y puede enviar
    // el mensaje 'loadApp' para cargar el iframe.
    vscode.postMessage({ command: 'webviewReady' });
  </script>
</body>
</html>`;
}

export function deactivate() {
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
