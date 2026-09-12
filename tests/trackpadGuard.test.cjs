const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { getTrackpadGuard } = require('../out/trackpadGuard');

function setup() {
  const registered = [];
  const window = {
    addEventListener: (type, handler, options) => { registered.push({ type, handler, options }); }
  };
  vm.runInNewContext(getTrackpadGuard(), { window });
  assert.equal(registered.length, 1);
  assert.equal(registered[0].type, 'wheel');
  assert.equal(registered[0].options.capture, true);
  assert.equal(registered[0].options.passive, false);
  return registered[0].handler;
}

function fakeWheel(extra = {}) {
  const calls = [];
  return {
    event: {
      ctrlKey: false, metaKey: false,
      preventDefault: () => calls.push('preventDefault'),
      stopPropagation: () => calls.push('stopPropagation'),
      ...extra
    },
    calls
  };
}

test('pinch gesture (ctrl+wheel) is swallowed before reaching the Flutter engine', () => {
  const handler = setup();
  const { event, calls } = fakeWheel({ ctrlKey: true });
  handler(event);
  assert.deepEqual(calls, ['preventDefault', 'stopPropagation']);
});

test('meta+wheel is also swallowed', () => {
  const handler = setup();
  const { event, calls } = fakeWheel({ metaKey: true });
  handler(event);
  assert.deepEqual(calls, ['preventDefault', 'stopPropagation']);
});

test('plain trackpad scroll is left untouched', () => {
  const handler = setup();
  const { event, calls } = fakeWheel({ deltaY: 3.5 });
  handler(event);
  assert.deepEqual(calls, []);
});
