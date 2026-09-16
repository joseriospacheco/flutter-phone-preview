import { randomBytes } from 'crypto';
import { Lang, t } from './i18n';

/** Renders the empty and startup states shown before the live preview is available. */
export function getSidebarIdleHtml(lang: Lang, starting: boolean): string {
  const nonce = randomBytes(16).toString('hex');
  const title = t(lang, starting ? 'sidebar.startingTitle' : 'sidebar.idleTitle');
  const description = t(lang, starting ? 'sidebar.startingDescription' : 'sidebar.idleDescription');

  return `<!DOCTYPE html>
<html lang='${lang}'>
<head>
<meta charset='UTF-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<meta http-equiv='Content-Security-Policy' content="default-src 'none'; style-src 'unsafe-inline';${starting ? '' : ` script-src 'nonce-${nonce}';`}">
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: light dark; }
  html, body { min-height: 100%; margin: 0; }
  body {
    --line: var(--vscode-panel-border, rgba(127, 127, 127, .24));
    --muted: var(--vscode-descriptionForeground, #9da5b4);
    --accent: var(--vscode-textLink-foreground, #4fc1ff);
    --surface: var(--vscode-editorWidget-background, rgba(127, 127, 127, .08));
    min-height: 100vh;
    padding: clamp(20px, 7vh, 56px) 18px 24px;
    color: var(--vscode-foreground);
    background:
      radial-gradient(circle at 50% 15%, color-mix(in srgb, var(--accent) 12%, transparent) 0, transparent 42%),
      var(--vscode-sideBar-background);
    font: 13px/1.5 var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  }
  .shell {
    width: min(100%, 380px);
    margin: 0 auto;
    text-align: center;
  }
  .visual {
    position: relative;
    width: 150px;
    height: 180px;
    margin: 0 auto 24px;
    display: grid;
    place-items: center;
  }
  .halo {
    position: absolute;
    inset: 24px 0 6px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    filter: blur(18px);
  }
  .device {
    position: relative;
    width: 86px;
    height: 164px;
    padding: 5px;
    border: 1px solid color-mix(in srgb, var(--vscode-foreground) 32%, transparent);
    border-radius: 22px;
    background: color-mix(in srgb, var(--vscode-sideBar-background) 82%, var(--vscode-foreground));
    box-shadow: 0 18px 42px rgba(0, 0, 0, .22), inset 0 0 0 1px rgba(255, 255, 255, .05);
    transform: rotate(5deg);
  }
  .screen {
    position: relative;
    height: 100%;
    overflow: hidden;
    border-radius: 17px;
    background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 28%, var(--vscode-editor-background)) 0%, var(--vscode-editor-background) 68%);
  }
  .island {
    position: absolute;
    top: 7px;
    left: 50%;
    width: 27px;
    height: 7px;
    transform: translateX(-50%);
    border-radius: 8px;
    background: rgba(0, 0, 0, .72);
  }
  .app-mark {
    position: absolute;
    top: 43px;
    left: 50%;
    width: 38px;
    height: 38px;
    transform: translateX(-50%) rotate(45deg);
  }
  .app-mark::before,
  .app-mark::after {
    content: '';
    position: absolute;
    border-radius: 3px;
    background: var(--accent);
  }
  .app-mark::before { inset: 0 18px 0 0; }
  .app-mark::after { inset: 18px 0 0 18px; opacity: .68; }
  .ui-line {
    position: absolute;
    left: 16px;
    height: 4px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--vscode-foreground) 24%, transparent);
  }
  .ui-line.one { right: 16px; bottom: 43px; }
  .ui-line.two { right: 29px; bottom: 32px; }
  .ui-button {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 14px;
    height: 9px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent) 78%, transparent);
  }
  .code-chip {
    position: absolute;
    left: 1px;
    bottom: 18px;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 9px;
    color: var(--accent);
    background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
    font: 600 12px/1 var(--vscode-editor-font-family, monospace);
  }
  .code-chip svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .eyebrow {
    margin-bottom: 8px;
    color: var(--accent);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .12em;
    text-transform: uppercase;
  }
  h1 {
    margin: 0;
    font-size: clamp(19px, 7vw, 24px);
    line-height: 1.2;
    font-weight: 650;
    letter-spacing: -.02em;
  }
  .description {
    max-width: 320px;
    margin: 10px auto 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.55;
  }
  .action-area { margin-top: 24px; }
  button {
    width: 100%;
    min-height: 38px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 9px 14px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    box-shadow: 0 4px 14px rgba(0, 0, 0, .12);
    font: 600 13px/1.2 var(--vscode-font-family, sans-serif);
    cursor: pointer;
  }
  button svg { width: 15px; height: 15px; fill: currentColor; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:active { transform: translateY(1px); }
  button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 3px; }
  .hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    margin-top: 12px;
    color: var(--muted);
    font-size: 11px;
  }
  .hint-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent);
  }
  .progress-card {
    margin-top: 24px;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    text-align: left;
  }
  .progress-row { display: flex; align-items: center; gap: 11px; }
  .spinner {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    border: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin .8s linear infinite;
  }
  .progress-copy { min-width: 0; }
  .progress-title { font-weight: 600; line-height: 1.25; }
  .progress-hint { margin-top: 3px; color: var(--muted); font-size: 11px; }
  .progress-track {
    height: 2px;
    margin-top: 13px;
    overflow: hidden;
    border-radius: 2px;
    background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
  }
  .progress-track::after {
    content: '';
    display: block;
    width: 42%;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    animation: progress 1.4s ease-in-out infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes progress {
    0% { transform: translateX(-110%); }
    100% { transform: translateX(350%); }
  }
  @media (max-width: 260px) {
    body { padding-inline: 12px; }
    .visual { transform: scale(.88); margin-bottom: 12px; }
    .code-chip { display: none; }
  }
  @media (max-height: 470px) {
    body { padding-top: 18px; }
    .visual { height: 120px; margin-bottom: 16px; }
    .device { transform: rotate(5deg) scale(.72); }
    .code-chip { bottom: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner, .progress-track::after { animation: none; }
    button:active { transform: none; }
  }
</style>
</head>
<body>
  <main class='shell'>
    <div class='visual' aria-hidden='true'>
      <div class='halo'></div>
      <div class='device'>
        <div class='screen'>
          <span class='island'></span>
          <span class='app-mark'></span>
          <span class='ui-line one'></span>
          <span class='ui-line two'></span>
          <span class='ui-button'></span>
        </div>
      </div>
      <span class='code-chip'>
        <svg viewBox='0 0 24 24'><path d='m8 5-7 7 7 7M16 5l7 7-7 7'/></svg>
        Flutter
      </span>
    </div>
    <div class='eyebrow'>${t(lang, 'sidebar.eyebrow')}</div>
    <h1>${title}</h1>
    <p class='description'>${description}</p>
    ${starting ? `
    <div class='progress-card' role='status' aria-live='polite' aria-busy='true'>
      <div class='progress-row'>
        <span class='spinner' aria-hidden='true'></span>
        <div class='progress-copy'>
          <div class='progress-title'>${t(lang, 'sidebar.compilingLabel')}</div>
          <div class='progress-hint'>${t(lang, 'sidebar.startingHint')}</div>
        </div>
      </div>
      <div class='progress-track' aria-hidden='true'></div>
    </div>` : `
    <div class='action-area'>
      <button type='button' id='startPreview'>
        <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M8 5.25v13.5a1 1 0 0 0 1.53.85l10.2-6.75a1 1 0 0 0 0-1.7L9.53 4.4A1 1 0 0 0 8 5.25Z'/></svg>
        <span>${t(lang, 'sidebar.start')}</span>
      </button>
      <div class='hint'><span class='hint-dot' aria-hidden='true'></span>${t(lang, 'sidebar.startHint')}</div>
    </div>`}
  </main>
  ${starting ? '' : `<script nonce='${nonce}'>
    const vscode = acquireVsCodeApi();
    document.getElementById('startPreview').addEventListener('click', () => vscode.postMessage({ command: 'startPreview' }));
  </script>`}
</body>
</html>`;
}
