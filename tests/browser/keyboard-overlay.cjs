// Run with Playwright available: node tests/browser/keyboard-overlay.cjs
// Set PHONE_PREVIEW_FLUTTER_FIXTURE to a built tests/fixtures/keyboard_overlay.dart
// web directory to also exercise a real Flutter Column and TextFields.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const compiledRequire = createRequire(path.join(root, 'out/extension.js'));
const { startPreviewProxy } = compiledRequire('./previewProxy');
const ctx = { exports: {}, require: name => name === 'vscode' ? {} : compiledRequire(name) };
vm.runInNewContext(fs.readFileSync(path.join(root, 'out/extension.js'), 'utf8') + '\nexports.render = getWebviewHtml;', ctx);
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = server => 'http://127.0.0.1:' + server.address().port;
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#f5fbf7;font:16px system-ui}h1{margin:16px;font-size:22px}
  label{position:absolute;left:20px;right:20px}#upper-label{top:60px}#lower-label{bottom:24px}
  input{box-sizing:border-box;display:block;width:100%;height:42px;font:inherit}
</style></head><body><h1>Keyboard overlay regression</h1>
<label id="upper-label">Upper field<input id="upper"></label>
<label id="lower-label">Lower field<input id="lower" inputmode="decimal"></label>
<script>window.resizeCount=0;addEventListener('resize',()=>window.resizeCount++);</script></body></html>`;

async function run(flutterRoot) {
  const upstream = http.createServer((req, res) => {
    if (!flutterRoot) { res.setHeader('Content-Type', 'text/html'); res.end(fixture); return; }
    const base = path.resolve(flutterRoot);
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(base, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.ttf': 'font/ttf' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await listen(upstream);
  const proxy = await startPreviewProxy(origin(upstream), 'iphone15', { enableRestProxy: false, persistPreferences: false });
  const host = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(ctx.exports.render(proxy.url, 'iphone15', proxy.token));
  });
  await listen(host);
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 400, height: 540 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.addInitScript(({ url }) => {
      window.previewMessages = [];
      window.acquireVsCodeApi = () => ({ postMessage(message) {
        window.previewMessages.push(message);
        if (message.command === 'webviewReady') setTimeout(() => window.postMessage({ command: 'loadApp', url }, '*'), 0);
      } });
    }, { url: proxy.url });
    await page.goto(origin(host));
    await page.waitForFunction(() => document.querySelector('#preview').src.startsWith('http'));
    const frame = await page.locator('#preview').contentFrame();
    if (flutterRoot) {
      await frame.locator('body').evaluate(() => new Promise(resolve => {
        const poll = () => window.overlayFixtureReady ? resolve() : setTimeout(poll, 50);
        poll();
      }));
    } else await frame.locator('#lower').waitFor();
    const metrics = () => frame.locator('body').evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const hide = async () => {
      await page.locator('#keyboardHide').click();
      await page.waitForFunction(() => document.getElementById('virtualKeyboard').hidden && !document.getElementById('preview').style.transform);
    };
    const focus = async name => {
      await frame.locator('body').evaluate((_, name) => {
        if (typeof window.focusOverlayField === 'function') window.focusOverlayField(name);
        else document.getElementById(name).focus({ preventScroll: true });
      }, name);
      await page.waitForFunction(() => !document.getElementById('virtualKeyboard').hidden);
      await settle();
    };
    const checkGeometry = async () => {
      const field = await frame.locator('body').evaluate(() => {
        let e = document.activeElement;
        while (e?.shadowRoot?.activeElement) e = e.shadowRoot.activeElement;
        const r = e.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, h: innerHeight };
      });
      const visible = await page.evaluate(rect => {
        const f = document.getElementById('preview').getBoundingClientRect();
        const k = document.getElementById('virtualKeyboard').getBoundingClientRect();
        const s = document.querySelector('.screen').getBoundingClientRect();
        return { fieldTop: f.top + rect.top * f.height / rect.h,
          fieldBottom: f.top + rect.bottom * f.height / rect.h,
          keyboardTop: k.top, keyboardBottom: k.bottom, screenTop: s.top, screenBottom: s.bottom };
      }, field);
      assert.ok(visible.fieldBottom <= visible.keyboardTop + 1, JSON.stringify(visible));
      assert.ok(visible.fieldTop >= visible.screenTop - 1, JSON.stringify(visible));
      assert.ok(visible.keyboardBottom <= visible.screenBottom + 1, JSON.stringify(visible));
    };
    const before = await metrics();
    assert.equal(await page.locator('#deviceSelect option').count(), 14);
    await focus('lower');
    assert.deepEqual(await metrics(), before, 'Opening the keyboard must not resize Flutter');
    await checkGeometry();
    await page.locator('#keyboardRows').getByRole('button', { name: '1', exact: true }).click();
    await page.locator('#keyboardRows').getByRole('button', { name: '.', exact: true }).click();
    await page.locator('#keyboardRows').getByRole('button', { name: '5', exact: true }).click();
    await frame.locator('body').evaluate(() => new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        let e = document.activeElement; while (e?.shadowRoot?.activeElement) e = e.shadowRoot.activeElement;
        if (e.value === '1.5') resolve();
        else if (Date.now() - start > 5000) reject(new Error('Typing did not reach the field'));
        else setTimeout(poll, 20);
      }; poll();
    }));
    await hide();
    assert.deepEqual(await metrics(), before);
    if (flutterRoot) {
      assert.deepEqual(await frame.locator('body').evaluate(() => window.overlayFixtureErrors || []), [], 'No Flutter rendering errors');
      assert.equal(await frame.locator('body').evaluate(() => window.overlayFixtureValue), '1.5');
    } else {
      await focus('upper');
      assert.equal(await page.locator('#preview').evaluate(e => e.style.transform), '', 'Upper fields must not move unnecessarily');
      await hide();
      for (const size of [{ width: 260, height: 460 }, { width: 1280, height: 900 }]) {
        await page.setViewportSize(size); await settle();
        for (const device of ['iphone15', 'galaxy_s22']) {
          await page.locator('#deviceSelect').selectOption(device); await settle();
          for (let orientation = 0; orientation < 2; orientation++) {
            const closed = await metrics();
            await focus('lower');
            assert.deepEqual(await metrics(), closed);
            await checkGeometry();
            await hide();
            await page.locator('#rotateBtn').click(); await settle();
          }
        }
      }
      await focus('lower');
      await page.locator('#reloadBtn').click();
      await page.waitForFunction(() => document.getElementById('virtualKeyboard').hidden);
      assert.equal(await page.locator('#preview').evaluate(e => e.style.transform), '');
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.previewMessages.filter(m => /RuntimeError/.test(m.command))), []);
    console.log('PASS: ' + (flutterRoot ? 'Flutter Column + TextFields' : 'HTML fields, small/large panels, portrait/landscape, typing, hide and reload') + ' with stable viewport');
  } finally {
    if (browser) await browser.close();
    proxy.dispose();
    await Promise.all([close(host), close(upstream)]);
  }
}
run().then(() => process.env.PHONE_PREVIEW_FLUTTER_FIXTURE ? run(process.env.PHONE_PREVIEW_FLUTTER_FIXTURE) : undefined)
  .catch(error => { console.error(error); process.exitCode = 1; });
