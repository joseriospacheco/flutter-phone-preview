"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_NETWORK_PROFILE = exports.NETWORK_PRESETS = void 0;
exports.sanitizeCustomProfile = sanitizeCustomProfile;
exports.sanitizeCustomProfiles = sanitizeCustomProfiles;
exports.resolveNetworkProfile = resolveNetworkProfile;
exports.customProfileLabel = customProfileLabel;
exports.NETWORK_PRESETS = [
    { id: 'unlimited', labelKey: 'network.unlimited', latencyMs: 0, downloadKbps: 0, uploadKbps: 0 },
    { id: 'fast4g', labelKey: 'network.fast4g', latencyMs: 60, downloadKbps: 9000, uploadKbps: 1500 },
    { id: 'slow4g', labelKey: 'network.slow4g', latencyMs: 170, downloadKbps: 1600, uploadKbps: 750 },
    { id: '3g', labelKey: 'network.3g', latencyMs: 400, downloadKbps: 400, uploadKbps: 400 },
    { id: 'offline', labelKey: 'network.offline', latencyMs: 0, downloadKbps: 0, uploadKbps: 0, offline: true }
];
exports.DEFAULT_NETWORK_PROFILE = exports.NETWORK_PRESETS[0];
const MAX_VALUE = 1000000;
function finiteNumber(value) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number) || number < 0 || number > MAX_VALUE)
        return undefined;
    return Math.round(number);
}
function sanitizeCustomProfile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const input = value;
    const latencyMs = finiteNumber(input.latencyMs);
    const downloadKbps = finiteNumber(input.downloadKbps);
    const uploadKbps = finiteNumber(input.uploadKbps);
    if (latencyMs === undefined || downloadKbps === undefined || uploadKbps === undefined ||
        downloadKbps === 0 || uploadKbps === 0)
        return undefined;
    const id = typeof input.id === 'string' && /^custom-[a-z0-9-]{1,80}$/i.test(input.id)
        ? input.id
        : `custom-${Date.now().toString(36)}`;
    return { id, custom: true, latencyMs, downloadKbps, uploadKbps };
}
function sanitizeCustomProfiles(value) {
    if (!Array.isArray(value))
        return [];
    const profiles = [];
    const ids = new Set();
    for (const item of value) {
        const profile = sanitizeCustomProfile(item);
        if (profile && !ids.has(profile.id)) {
            ids.add(profile.id);
            profiles.push(profile);
        }
        if (profiles.length >= 20)
            break;
    }
    return profiles;
}
function resolveNetworkProfile(id, customProfiles) {
    if (typeof id !== 'string')
        return exports.DEFAULT_NETWORK_PROFILE;
    return exports.NETWORK_PRESETS.find(profile => profile.id === id) ||
        customProfiles.find(profile => profile.id === id) || exports.DEFAULT_NETWORK_PROFILE;
}
function customProfileLabel(profile) {
    return `${profile.latencyMs} ms · ↓${profile.downloadKbps} · ↑${profile.uploadKbps} Kbit/s`;
}
//# sourceMappingURL=networkProfiles.js.map