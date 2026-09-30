"use strict";
// Pure helpers for the screenshot flow (no DOM access, unit-testable).
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScreenshotFilename = buildScreenshotFilename;
exports.isScreenshotResult = isScreenshotResult;
// flutter-iphone15-portrait-20260930-153005.png
function buildScreenshotFilename(deviceId, rotated, now = new Date()) {
    const safeDevice = deviceId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'device';
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `flutter-${safeDevice}-${rotated ? 'landscape' : 'portrait'}-${stamp}.png`;
}
function isScreenshotResult(message, token) {
    if (!message || typeof message !== 'object')
        return false;
    const msg = message;
    return msg.source === 'phone-preview-screenshot' &&
        msg.token === token &&
        (typeof msg.id === 'string' || typeof msg.id === 'number') &&
        typeof msg.ok === 'boolean';
}
//# sourceMappingURL=screenshot.js.map