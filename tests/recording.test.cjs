const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { buildRecordingFilename, toRecordingChunk } = require('../out/recording.js');
const { getScreenRecordingBridge } = require('../out/screenRecordingBridge.js');

const fixedDate = new Date(2026, 8, 30, 15, 30, 5);

test('buildRecordingFilename includes device, orientation, timestamp, and safe extension', () => {
  assert.equal(
    buildRecordingFilename('iphone15', false, fixedDate),
    'flutter-iphone15-portrait-20260930-153005.webm'
  );
  assert.equal(
    buildRecordingFilename('../../galaxy_s24_ultra', true, fixedDate),
    'flutter-galaxy-s24-ultra-landscape-20260930-153005.webm'
  );
});

test('toRecordingChunk accepts transferred ArrayBuffers and views only', () => {
  const buffer = new Uint8Array([0, 255, 19, 42]);
  assert.deepEqual(toRecordingChunk(buffer.buffer), Buffer.from(buffer));
  assert.deepEqual(toRecordingChunk(buffer.subarray(1, 3)), Buffer.from([255, 19]));
  assert.deepEqual(toRecordingChunk('AP8TKg=='), Buffer.from([0, 255, 19, 42]));
  assert.equal(toRecordingChunk('not base64!'), undefined);
  assert.equal(toRecordingChunk('not a buffer'), undefined);
  assert.equal(toRecordingChunk(null), undefined);
});

test('recording bridge validates its session and exposes the chunked WebM protocol', () => {
  const token = 'record-session-42';
  const bridge = getScreenRecordingBridge(token);
  assert.ok(bridge.includes(JSON.stringify(token)));
  assert.ok(bridge.includes('phone-preview-record-control'));
  assert.ok(bridge.includes('phone-preview-recording'));
  assert.ok(bridge.includes("recorder.start(1000)"));
  assert.ok(bridge.includes('captureStream(30)'));
  assert.ok(bridge.includes("send('stopped'"));
});

test('recording bridge streams canvas chunks and rejects a different session token', async () => {
  const messages = [];
  let messageListener;
  const parent = { postMessage(message) { messages.push(message); } };
  const stream = { getTracks: () => [{ stop() {} }] };
  const canvas = { tagName: 'CANVAS', width: 400, height: 800, captureStream: () => stream };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor(_stream, options) { this.mimeType = options.mimeType; this.handlers = {}; this.state = 'inactive'; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    start(timeslice) { this.state = 'recording'; assert.equal(timeslice, 1000); this.handlers.start(); }
    stop() {
      this.state = 'inactive';
      this.handlers.dataavailable({ data: { size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } });
      setImmediate(() => this.handlers.stop());
    }
  }
  const window = { addEventListener(name, handler) { if (name === 'message') messageListener = handler; } };
  const sandbox = {
    URL,
    setTimeout,
    Promise,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    MediaRecorder: Recorder,
    document: { referrer: '', querySelectorAll: selector => selector === '*' ? [canvas] : [] },
    parent,
    window
  };
  vm.runInNewContext(getScreenRecordingBridge('session-a'), sandbox);
  messageListener({ source: parent, data: { source: 'phone-preview-record-control', token: 'wrong', action: 'start' } });
  assert.equal(messages.length, 0, 'a foreign token must not start capture');
  messageListener({ source: parent, data: { source: 'phone-preview-record-control', token: 'session-a', action: 'start' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages[0].event, 'started');
  messageListener({ source: parent, data: { source: 'phone-preview-record-control', token: 'session-a', action: 'stop' } });
  for (let i = 0; i < 20 && !messages.some(message => message.event === 'stopped'); i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.deepEqual(messages.map(message => message.event), ['started', 'chunk', 'stopped']);
  assert.equal(Buffer.from(messages[1].data, 'base64').toString('hex'), '010203');
});
