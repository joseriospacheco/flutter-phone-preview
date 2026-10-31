const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { getNotificationBridge } = require('../out/notificationBridge.js');

test('notification bridge grants permission and relays constructor notifications', async () => {
  const messages = [];
  let messageListener;
  const parent = { postMessage(message) { messages.push(message); } };
  function ServiceWorkerRegistration() {}
  const nativeQueries = [];
  const navigator = { permissions: { query(descriptor) { nativeQueries.push(descriptor); return Promise.resolve({ state: 'prompt' }); } } };
  const window = {
    ServiceWorkerRegistration,
    addEventListener(name, listener) { if (name === 'message') messageListener = listener; }
  };
  const sandbox = {
    URL, Map, Promise, Event, EventTarget, queueMicrotask,
    document: { referrer: '' }, navigator, parent, window
  };
  vm.runInNewContext(getNotificationBridge('notify-token'), sandbox);

  assert.equal(window.Notification.permission, 'granted');
  assert.equal(await window.Notification.requestPermission(), 'granted');
  let callbackPermission;
  await window.Notification.requestPermission(value => { callbackPermission = value; });
  assert.equal(callbackPermission, 'granted');

  let shown = false;
  let clicked = false;
  let closed = false;
  const notification = new window.Notification('New booking', { body: 'At 10:30', tag: 'booking-1' });
  notification.onshow = () => { shown = true; };
  notification.onclick = () => { clicked = true; };
  notification.onclose = () => { closed = true; };
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(shown, true);
  assert.deepEqual(
    { source: messages[0].source, token: messages[0].token, title: messages[0].title, body: messages[0].body, tag: messages[0].tag },
    { source: 'phone-preview-notification', token: 'notify-token', title: 'New booking', body: 'At 10:30', tag: 'booking-1' }
  );
  messageListener({ source: parent, data: { command: 'notificationClicked', token: 'wrong', id: messages[0].id } });
  assert.equal(clicked, false);
  messageListener({ source: parent, data: { command: 'notificationClicked', token: 'notify-token', id: messages[0].id } });
  assert.equal(clicked, true);
  notification.close();
  assert.equal(closed, true);

  assert.equal(await navigator.permissions.query({ name: 'notifications' }).then(status => status.state), 'granted');
  assert.equal(await navigator.permissions.query({ name: 'camera' }).then(status => status.state), 'prompt');
  assert.deepEqual(nativeQueries, [{ name: 'camera' }]);
});

test('notification bridge relays ServiceWorkerRegistration.showNotification', async () => {
  const messages = [];
  function ServiceWorkerRegistration() {}
  const parent = { postMessage(message) { messages.push(message); } };
  const window = { ServiceWorkerRegistration, addEventListener() {} };
  vm.runInNewContext(getNotificationBridge('service-token'), {
    URL, Map, Promise, Event, EventTarget, queueMicrotask,
    document: { referrer: '' }, navigator: {}, parent, window
  });
  const registration = new ServiceWorkerRegistration();
  assert.equal(await registration.showNotification('Background update', { body: 'Ready' }), undefined);
  assert.equal(messages[0].title, 'Background update');
  assert.equal(messages[0].body, 'Ready');
  assert.equal(messages[0].id, 0);
});
