const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { STR, resolveLang, t } = require('../out/i18n');

const root = path.join(__dirname, '..');
const nlsEn = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
const nlsEs = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.es.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('en and es dictionaries have the same keys with no empty values', () => {
  const enKeys = Object.keys(STR.en).sort();
  const esKeys = Object.keys(STR.es).sort();
  assert.deepEqual(esKeys, enKeys);
  for (const key of enKeys) {
    assert.ok(STR.en[key].length > 0, `en.${key} is empty`);
    assert.ok(STR.es[key].length > 0, `es.${key} is empty`);
  }
});

test('t() interpolates, falls back to English and then to the key', () => {
  assert.equal(t('es', 'host.starting', { port: 5001 }), 'Iniciando: flutter run -d web-server --web-port 5001');
  assert.equal(t('en', 'host.starting', { port: 5001 }), 'Starting: flutter run -d web-server --web-port 5001');
  assert.equal(t('fr', 'host.flutterStopped'), STR.en['host.flutterStopped']);
  assert.equal(t('es', 'missing.key'), 'missing.key');
});

test('resolveLang follows VS Code locale with manual override', () => {
  assert.equal(resolveLang('es', 'auto'), 'es');
  assert.equal(resolveLang('es-MX', 'auto'), 'es');
  assert.equal(resolveLang('ES', 'auto'), 'es');
  assert.equal(resolveLang('en', 'auto'), 'en');
  assert.equal(resolveLang('en-US', 'auto'), 'en');
  assert.equal(resolveLang('fr', 'auto'), 'en');
  assert.equal(resolveLang(undefined, 'auto'), 'en');
  assert.equal(resolveLang('es', 'en'), 'en');
  assert.equal(resolveLang('en', 'es'), 'es');
});

function collectRefs(value, into) {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/%([A-Za-z0-9_.]+)%/g)) into.add(m[1]);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectRefs(v, into));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectRefs(v, into));
  }
  return into;
}

test('every %key% in package.json exists in both nls files', () => {
  const refs = collectRefs(pkg.contributes, new Set());
  assert.ok(refs.size > 0);
  for (const key of refs) {
    assert.ok(key in nlsEn, `package.nls.json missing ${key}`);
    assert.ok(key in nlsEs, `package.nls.es.json missing ${key}`);
    assert.ok(nlsEn[key].length > 0 && nlsEs[key].length > 0, `${key} is empty`);
  }
});

test('language setting offers auto/es/en', () => {
  const lang = pkg.contributes.configuration.properties['flutterPhonePreview.language'];
  assert.deepEqual(lang.enum, ['auto', 'es', 'en']);
  assert.equal(lang.default, 'auto');
});
