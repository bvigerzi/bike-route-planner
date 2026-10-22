import type { LatLng, LegMode } from './routing';

export interface RouteState {
  name: string;
  waypoints: (LatLng & { label?: string })[];
  legModes: LegMode[];
}

/**
 * The route is kept in the URL hash as base64url (no padding) of a compact binary encoding.
 * The whole route is in the link, so no database is needed. Bytes, in order:
 *
 *   version            1 byte, VERSION
 *   name               varint byte length, then UTF-8
 *   count              varint: waypoints << 1 | 1 if any leg is direct
 *   per waypoint       zigzag varint lat, zigzag varint lng (units of 1e-5°, each a delta from the
 *                      previous waypoint, the first from 0), then the label as for the name (0 = none)
 *   leg modes          only if the direct flag is set: one bit per leg, LSB first, 1 = direct
 *
 * Varints are LEB128: 7 bits per byte, low bits first, high bit set on all but the last byte.
 * Nearby waypoints differ by a few km, so each costs ~5 bytes (~7 chars) plus its label: 100
 * waypoints is ~0.7 KB. Some apps truncate links past ~2,000 chars when shared (see URL_WARN_LENGTH).
 *
 * Links from before this format (#v=1&n=...&m=...&w=lat,lng,label;...) still decode.
 */
const VERSION = 2;

/** Coordinates are kept to 5 decimal places (~1.1 m). */
const SCALE = 1e5;

export function roundCoord(n: number): number {
  return Math.round(n * SCALE) / SCALE;
}

class Writer {
  bytes: number[] = [];

  varint(n: number) {
    while (n > 0x7f) {
      this.bytes.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    this.bytes.push(n);
  }

  zigzag(n: number) {
    this.varint(n < 0 ? -2 * n - 1 : 2 * n);
  }

  string(s: string) {
    const utf8 = new TextEncoder().encode(s);
    this.varint(utf8.length);
    for (const b of utf8) this.bytes.push(b);
  }
}

class Reader {
  pos = 0;
  constructor(private bytes: Uint8Array) {}

  get done() {
    return this.pos === this.bytes.length;
  }

  byte(): number {
    if (this.pos >= this.bytes.length) throw new RangeError('Unexpected end of route');
    return this.bytes[this.pos++];
  }

  varint(): number {
    let n = 0;
    for (let shift = 0; ; shift += 7) {
      // Coordinates and lengths fit in 32 bits (5 varint bytes).
      if (shift > 28) throw new RangeError('Varint too long');
      const b = this.byte();
      n += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return n;
    }
  }

  zigzag(): number {
    const n = this.varint();
    return n % 2 ? -(n + 1) / 2 : n / 2;
  }

  string(): string {
    const length = this.varint();
    if (this.pos + length > this.bytes.length) throw new RangeError('Unexpected end of route');
    const s = new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(this.pos, this.pos + length));
    this.pos += length;
    return s;
  }
}

function toBase64Url(bytes: number[]): string {
  // Built a char at a time: spreading a long route into fromCharCode can exceed the argument limit.
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Throws on characters outside base64url or an impossible length. */
function fromBase64Url(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

export function encodeRoute(s: RouteState): string {
  if (!s.name && !s.waypoints.length) return '';
  const w = new Writer();
  w.bytes.push(VERSION);
  w.string(s.name);
  const hasDirect = s.legModes.includes('direct');
  w.varint(s.waypoints.length * 2 + (hasDirect ? 1 : 0));
  let [lat, lng] = [0, 0];
  for (const p of s.waypoints) {
    const [pLat, pLng] = [Math.round(p.lat * SCALE), Math.round(p.lng * SCALE)];
    w.zigzag(pLat - lat);
    w.zigzag(pLng - lng);
    [lat, lng] = [pLat, pLng];
    w.string(p.label ?? '');
  }
  if (hasDirect) {
    const bits = new Array<number>(Math.ceil(s.legModes.length / 8)).fill(0);
    s.legModes.forEach((m, i) => {
      if (m === 'direct') bits[i >> 3] |= 1 << (i & 7);
    });
    for (const b of bits) w.bytes.push(b);
  }
  return toBase64Url(w.bytes);
}

/** Returns null if the hash isn't a route this version understands. */
export function decodeRoute(hash: string): RouteState | null {
  hash = hash.replace(/^#/, '');
  // v1 links always contain '=', which base64url (unpadded) never does.
  if (!/^[A-Za-z0-9_-]+$/.test(hash)) return decodeRouteV1(hash);
  try {
    const r = new Reader(fromBase64Url(hash));
    if (r.byte() !== VERSION) return null;
    const name = r.string();
    const count = r.varint();
    const n = Math.floor(count / 2);
    const waypoints: RouteState['waypoints'] = [];
    let [lat, lng] = [0, 0];
    for (let i = 0; i < n; i++) {
      lat += r.zigzag();
      lng += r.zigzag();
      if (Math.abs(lat) > 90 * SCALE || Math.abs(lng) > 180 * SCALE) return null;
      const label = r.string();
      const p = { lat: lat / SCALE, lng: lng / SCALE };
      waypoints.push(label ? { ...p, label } : p);
    }
    const legs = Math.max(0, n - 1);
    const legModes: LegMode[] = Array(legs).fill('route');
    if (count % 2) {
      const bits = Array.from({ length: Math.ceil(legs / 8) }, () => r.byte());
      for (let i = 0; i < legs; i++) if (bits[i >> 3] & (1 << (i & 7))) legModes[i] = 'direct';
    }
    return r.done ? { name, waypoints, legModes } : null;
  } catch {
    // Invalid base64, truncated data or malformed UTF-8.
    return null;
  }
}

/** The original readable format: v=1&n=name&m=rrd&w=lat,lng,label;lat,lng (percent-encoded). */
function decodeRouteV1(hash: string): RouteState | null {
  const params = new Map<string, string>();
  for (const part of hash.split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) params.set(part.slice(0, eq), part.slice(eq + 1));
  }
  if (params.get('v') !== '1') return null;
  try {
    const name = decodeURIComponent(params.get('n') ?? '');
    const w = params.get('w');
    const waypoints: RouteState['waypoints'] = [];
    for (const entry of w ? w.split(';') : []) {
      const [latS, lngS, label, ...rest] = entry.split(',');
      const lat = Number(latS);
      const lng = Number(lngS);
      if (rest.length || !latS || !lngS || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) return null;
      waypoints.push(label ? { lat, lng, label: decodeURIComponent(label) } : { lat, lng });
    }
    const legs = Math.max(0, waypoints.length - 1);
    const m = params.get('m') ?? '';
    const legModes: LegMode[] =
      m.length === legs && /^[rd]*$/.test(m)
        ? [...m].map((c) => (c === 'd' ? 'direct' : 'route'))
        : Array(legs).fill('route');
    return { name, waypoints, legModes };
  } catch {
    // Malformed percent-encoding.
    return null;
  }
}
