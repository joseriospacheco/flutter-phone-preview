const assert = require('node:assert/strict');
const test = require('node:test');
const { getSidebarIdleHtml } = require('../out/sidebarIdle.js');

test('idle sidebar renders the polished launch state in both languages', () => {
  const es = getSidebarIdleHtml('es', false);
  const en = getSidebarIdleHtml('en', false);

  assert.match(es, /Vista previa en dispositivo/);
  assert.match(es, /Iniciar vista previa/);
  assert.match(en, /Device preview/);
  assert.match(en, /Start preview/);
  assert.match(es, /class='device'/);
  assert.match(es, /id='startPreview'/);
  assert.match(es, /acquireVsCodeApi/);
  assert.match(es, /script-src 'nonce-[a-f0-9]+'/);
});

test('starting sidebar renders progress without an actionable start button', () => {
  const html = getSidebarIdleHtml('es', true);

  assert.match(html, /Preparando la vista previa/);
  assert.match(html, /Compilando Flutter Web/);
  assert.match(html, /role='status'/);
  assert.match(html, /aria-busy='true'/);
  assert.match(html, /class='spinner'/);
  assert.doesNotMatch(html, /id='startPreview'/);
  assert.doesNotMatch(html, /acquireVsCodeApi/);
});

test('sidebar styles account for narrow panels and reduced motion', () => {
  const html = getSidebarIdleHtml('en', false);

  assert.match(html, /@media \(max-width: 260px\)/);
  assert.match(html, /@media \(max-height: 470px\)/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(html, /var\(--vscode-button-background\)/);
  assert.match(html, /var\(--vscode-focusBorder\)/);
});
