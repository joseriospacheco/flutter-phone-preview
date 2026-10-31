export function buildRecordingFilename(deviceId: string, rotated: boolean, now: Date = new Date()): string {
  const safeDevice = deviceId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'device';
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `flutter-${safeDevice}-${rotated ? 'landscape' : 'portrait'}-${stamp}.webm`;
}

export function toRecordingChunk(value: unknown): Buffer | undefined {
  if (typeof value === 'string' && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return Buffer.from(value, 'base64');
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return undefined;
}
