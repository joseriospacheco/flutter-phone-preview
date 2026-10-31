const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NETWORK_PRESETS, resolveNetworkProfile, sanitizeCustomProfile, sanitizeCustomProfiles } = require('../out/networkProfiles.js');

test('network profiles validate persisted custom values and resolve presets', () => {
  assert.equal(resolveNetworkProfile('3g', []).id, '3g');
  assert.equal(NETWORK_PRESETS.find(profile => profile.id === 'offline').offline, true);
  const custom = sanitizeCustomProfile({ id: 'custom-test', latencyMs: 125, downloadKbps: 900, uploadKbps: 350 });
  assert.deepEqual(custom, { id: 'custom-test', custom: true, latencyMs: 125, downloadKbps: 900, uploadKbps: 350 });
  assert.equal(resolveNetworkProfile('custom-test', [custom]).id, 'custom-test');
  assert.equal(sanitizeCustomProfile({ latencyMs: -1, downloadKbps: 1, uploadKbps: 1 }), undefined);
  assert.equal(sanitizeCustomProfile({ latencyMs: 0, downloadKbps: 0, uploadKbps: 1 }), undefined);
  assert.equal(sanitizeCustomProfiles([custom, custom]).length, 1);
  assert.equal(resolveNetworkProfile('missing', []).id, 'unlimited');
});
