// Pure helpers for the screenshot flow (no DOM access, unit-testable).

// flutter-iphone15-portrait-20260930-153005.png
export function buildScreenshotFilename(deviceId: string, rotated: boolean, now: Date = new Date()): string {
  const safeDevice = deviceId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'device';
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `flutter-${safeDevice}-${rotated ? 'landscape' : 'portrait'}-${stamp}.png`;
}

export function isScreenshotResult(message: unknown, token: string): message is {
  id: string | number; ok: boolean; width?: number; height?: number; buffer?: unknown;
} {
  if (!message || typeof message !== 'object') return false;
  const msg = message as Record<string, unknown>;
  return msg.source === 'phone-preview-screenshot' &&
    msg.token === token &&
    (typeof msg.id === 'string' || typeof msg.id === 'number') &&
    typeof msg.ok === 'boolean';
}
