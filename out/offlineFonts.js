"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFLINE_ROBOTO_PATH = void 0;
exports.withOfflineRoboto = withOfflineRoboto;
exports.readOfflineRoboto = readOfflineRoboto;
const promises_1 = require("fs/promises");
const path = require("path");
exports.OFFLINE_ROBOTO_PATH = '/__phone_preview_fonts/roboto-regular.ttf';
// Adds the bundled Roboto fallback only when the app does not declare its
// own Roboto family. Returns the manifest untouched otherwise, including
// invalid JSON which Flutter must report with its normal error.
function withOfflineRoboto(manifest, assetUrl) {
    let families;
    try {
        families = JSON.parse(manifest);
    }
    catch {
        return manifest;
    }
    if (!Array.isArray(families))
        return manifest;
    if (families.some(entry => entry?.family === 'Roboto'))
        return manifest;
    return JSON.stringify([...families, { family: 'Roboto', fonts: [{ asset: assetUrl }] }]);
}
function readOfflineRoboto() {
    return (0, promises_1.readFile)(path.join(__dirname, '..', 'resources', 'fonts', 'roboto-regular.ttf'));
}
//# sourceMappingURL=offlineFonts.js.map