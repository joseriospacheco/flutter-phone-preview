const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { resolveLang, STR, t } = require('../out/i18n.js');

const ROOT = path.join(__dirname, '..');

test('en and es dictionaries have the same keys', () => {
  const en = Object.keys(STR.en).sort();
  const es = Object.keys(STR.es).sort();
  assert.deepEqual(en, es, 'key sets diverge between en/es');
});

test('t() returns the translated value and interpolates vars', () => {
  assert.equal(t('en', 'host.panelTitle'), 'Flutter — Phone View');
  assert.equal(t('es', 'host.panelTitle'), 'Flutter — Vista de Teléfono');
  assert.equal(t('es', 'host.starting', { port: 5001 }), 'Iniciando: flutter run -d web-server --web-port 5001');
  assert.equal(t('en', 'host.portCheckTitle', { port: 9 }), 'Port 9 is already in use (a previous "flutter run" is probably still around).');
});

test('t() falls back to the key itself when missing', () => {
  assert.equal(t('es', 'does.not.exist'), 'does.not.exist');
});

test('t() interpolates numbers and ignores unmatched vars', () => {
  assert.equal(t('en', 'host.flutterExited', { code: 255, label: 'ignored' }), '\nFlutter exited with code 255');
});

test('resolveLang picks es from locale prefixes and en otherwise', () => {
  assert.equal(resolveLang('es', 'auto'), 'es');
  assert.equal(resolveLang('es-MX', 'auto'), 'es');
  assert.equal(resolveLang('es_419', 'auto'), 'es');
  assert.equal(resolveLang('en', 'auto'), 'en');
  assert.equal(resolveLang('fr-FR', 'auto'), 'en');
  assert.equal(resolveLang(undefined, 'auto'), 'en');
  assert.equal(resolveLang('es', 'en'), 'en');
  assert.equal(resolveLang('en', 'es'), 'es');
  assert.equal(resolveLang('fr', 'en'), 'en');
});

test('every %key% used in package.json exists in both nls files', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const nlsEn = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.nls.json'), 'utf8'));
  const nlsEs = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.nls.es.json'), 'utf8'));

  const keys = new Set();
  const scan = (obj) => {
    if (typeof obj === 'string') {
      const m = obj.match(/%(cmd|config)\.[^%]+%/g);
      if (m) m.forEach((k) => keys.add(k));
    } else if (Array.isArray(obj)) {
      obj.forEach(scan);
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(scan);
    }
  };
  scan(pkg);

  const enKeys = Object.keys(nlsEn).map((k) => `%${k}%`);
  const esKeys = Object.keys(nlsEs).map((k) => `%${k}%`);
  for (const key of keys) {
    assert.ok(enKeys.includes(key), `missing in package.nls.json: ${key}`);
    assert.ok(esKeys.includes(key), `missing in package.nls.es.json: ${key}`);
  }
  assert.ok(keys.size > 0, 'no %cmd.*%/%config.*% keys found in package.json');
});