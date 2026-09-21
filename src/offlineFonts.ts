import { readFile } from 'fs/promises';
import * as path from 'path';

export const OFFLINE_ROBOTO_PATH = '/__phone_preview_fonts/roboto-regular.ttf';

// Adds the bundled Roboto fallback only when the app does not declare its
// own Roboto family. Returns the manifest untouched otherwise, including
// invalid JSON which Flutter must report with its normal error.
export function withOfflineRoboto(manifest: string, assetUrl: string): string {
  let families: unknown;
  try {
    families = JSON.parse(manifest);
  } catch {
    return manifest;
  }
  if (!Array.isArray(families)) return manifest;
  if (families.some(entry => entry?.family === 'Roboto')) return manifest;
  return JSON.stringify([...families, { family: 'Roboto', fonts: [{ asset: assetUrl }] }]);
}

export function readOfflineRoboto(): Promise<Buffer> {
  return readFile(path.join(__dirname, '..', 'resources', 'fonts', 'roboto-regular.ttf'));
}

