import type { LatLng, LegResult } from './routing';

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** The routed track as GPX 1.1: the waypoints as <wpt>, and every leg joined into one track segment. */
export function toGpx(name: string, waypoints: (LatLng & { label?: string; name?: string })[], legs: LegResult[]): string {
  const title = escapeXml(name || 'Route');
  const wpts = waypoints.map(
    (w, i) => `  <wpt lat="${w.lat}" lon="${w.lng}"><name>${escapeXml(w.name ?? w.label ?? (i === 0 ? 'Start' : `Stop ${i}`))}</name></wpt>`,
  );
  // Each segment (and leg) starts where the previous one ended; drop the repeated point.
  const points: [number, number][] = [];
  for (const leg of legs) {
    for (const seg of leg.segments) {
      for (const p of seg.coords) {
        const last = points.at(-1);
        if (!last || last[0] !== p[0] || last[1] !== p[1]) points.push(p);
      }
    }
  }
  const trkpts = points.map(([lat, lng]) => `      <trkpt lat="${lat}" lon="${lng}"/>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Bike Route Planner" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${title}</name></metadata>`,
    ...wpts,
    `  <trk><name>${title}</name>`,
    '    <trkseg>',
    ...trkpts,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}
