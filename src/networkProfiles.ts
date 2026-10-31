export interface NetworkCondition {
  latencyMs: number;
  downloadKbps: number;
  uploadKbps: number;
  offline?: boolean;
}

export interface NetworkProfile extends NetworkCondition {
  id: string;
  labelKey?: string;
  custom?: boolean;
}

export const NETWORK_PRESETS: readonly NetworkProfile[] = [
  { id: 'unlimited', labelKey: 'network.unlimited', latencyMs: 0, downloadKbps: 0, uploadKbps: 0 },
  { id: 'fast4g', labelKey: 'network.fast4g', latencyMs: 60, downloadKbps: 9000, uploadKbps: 1500 },
  { id: 'slow4g', labelKey: 'network.slow4g', latencyMs: 170, downloadKbps: 1600, uploadKbps: 750 },
  { id: '3g', labelKey: 'network.3g', latencyMs: 400, downloadKbps: 400, uploadKbps: 400 },
  { id: 'offline', labelKey: 'network.offline', latencyMs: 0, downloadKbps: 0, uploadKbps: 0, offline: true }
];

export const DEFAULT_NETWORK_PROFILE: NetworkProfile = NETWORK_PRESETS[0];
const MAX_VALUE = 1_000_000;

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_VALUE) return undefined;
  return Math.round(number);
}

export function sanitizeCustomProfile(value: unknown): NetworkProfile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const latencyMs = finiteNumber(input.latencyMs);
  const downloadKbps = finiteNumber(input.downloadKbps);
  const uploadKbps = finiteNumber(input.uploadKbps);
  if (latencyMs === undefined || downloadKbps === undefined || uploadKbps === undefined ||
      downloadKbps === 0 || uploadKbps === 0) return undefined;
  const id = typeof input.id === 'string' && /^custom-[a-z0-9-]{1,80}$/i.test(input.id)
    ? input.id
    : `custom-${Date.now().toString(36)}`;
  return { id, custom: true, latencyMs, downloadKbps, uploadKbps };
}

export function sanitizeCustomProfiles(value: unknown): NetworkProfile[] {
  if (!Array.isArray(value)) return [];
  const profiles: NetworkProfile[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const profile = sanitizeCustomProfile(item);
    if (profile && !ids.has(profile.id)) {
      ids.add(profile.id);
      profiles.push(profile);
    }
    if (profiles.length >= 20) break;
  }
  return profiles;
}

export function resolveNetworkProfile(id: unknown, customProfiles: readonly NetworkProfile[]): NetworkProfile {
  if (typeof id !== 'string') return DEFAULT_NETWORK_PROFILE;
  return NETWORK_PRESETS.find(profile => profile.id === id) ||
    customProfiles.find(profile => profile.id === id) || DEFAULT_NETWORK_PROFILE;
}

export function customProfileLabel(profile: NetworkProfile): string {
  return `${profile.latencyMs} ms · ↓${profile.downloadKbps} · ↑${profile.uploadKbps} Kbit/s`;
}
