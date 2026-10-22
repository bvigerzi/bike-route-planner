import { CATEGORIES } from './categories';
import { IMAGE_LINE_SCALE, IMAGE_MAX_ASPECT, IMAGE_MAX_PX, IMAGE_PADDING_PX, IMAGE_SCALE, TILE_MAX_ZOOM, TILE_SIZE, TILE_URL } from './config';
import type { LatLng, LegResult } from './routing';

// Renders the route to a canvas from the raw tiles, independent of the on-screen map (and its library).

export interface ImageView {
  zoom: number;
  /** World pixel position (Web Mercator, at `zoom`) of the image's top-left corner. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** World pixel position of a point at the given zoom (Web Mercator, as used by OSM tiles). */
export function project(lat: number, lng: number, zoom: number): [number, number] {
  const size = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}

/**
 * The closest zoom at which all the points, plus padding, fit within maxPx each way, and the image
 * cropped to them. The short side is extended (keeping the points centred) to limit the aspect ratio.
 */
export function fitView(
  points: [number, number][],
  maxPx = IMAGE_MAX_PX,
  padding = IMAGE_PADDING_PX,
  maxAspect = IMAGE_MAX_ASPECT,
): ImageView {
  for (let zoom = 19; zoom >= 0; zoom--) {
    const px = points.map(([lat, lng]) => project(lat, lng, zoom));
    const xs = px.map((p) => p[0]);
    const ys = px.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    let width = Math.ceil(maxX - minX + 2 * padding);
    let height = Math.ceil(maxY - minY + 2 * padding);
    if ((width > maxPx || height > maxPx) && zoom > 0) continue;
    width = Math.max(width, Math.ceil(height / maxAspect));
    height = Math.max(height, Math.ceil(width / maxAspect));
    return {
      zoom,
      left: Math.round((minX + maxX - width) / 2),
      top: Math.round((minY + maxY - height) / 2),
      width,
      height,
    };
  }
  throw new Error('unreachable');
}

function loadTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // The OSM tile servers allow CORS, which keeps the canvas exportable.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = TILE_URL.replace('{z}', `${z}`).replace('{x}', `${x}`).replace('{y}', `${y}`);
  });
}

function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, 2 * Math.PI);
  ctx.fillStyle = '#c0392b';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${text.length > 1 ? 9 : 12}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}

/**
 * A PNG of the route, zoomed to fit every waypoint and the routed track, at IMAGE_SCALE times the
 * layout size. Only the start and end are marked, so the route itself stays clear.
 */
export async function renderRouteImage(waypoints: LatLng[], legs: LegResult[], loop: boolean): Promise<Blob> {
  const segments = legs.flatMap((l) => l.segments);
  const view = fitView([...waypoints.map((w): [number, number] => [w.lat, w.lng]), ...segments.flatMap((s) => s.coords)]);
  const { zoom, left, top, width, height } = view;
  const canvas = document.createElement('canvas');
  canvas.width = width * IMAGE_SCALE;
  canvas.height = height * IMAGE_SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ddd';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Tiles from a deeper zoom, at their own resolution, in canvas pixels. Past the deepest zoom the
  // servers provide, those tiles are stretched instead.
  const tileZoom = Math.min(zoom + Math.log2(IMAGE_SCALE), TILE_MAX_ZOOM);
  const tileScale = IMAGE_SCALE / 2 ** (tileZoom - zoom);
  const tileSize = TILE_SIZE * tileScale;
  const [tileLeft, tileTop] = [left * IMAGE_SCALE, top * IMAGE_SCALE];
  // Any tiles that fail to load are left blank.
  const n = 2 ** tileZoom;
  const tiles: Promise<void>[] = [];
  for (let ty = Math.floor(tileTop / tileSize); ty <= Math.floor((tileTop + canvas.height - 1) / tileSize); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(tileLeft / tileSize); tx <= Math.floor((tileLeft + canvas.width - 1) / tileSize); tx++) {
      const [dx, dy] = [tx * tileSize - tileLeft, ty * tileSize - tileTop];
      tiles.push(loadTile(tileZoom, ((tx % n) + n) % n, ty).then((img) => {
        if (img) ctx.drawImage(img, dx, dy, tileSize, tileSize);
      }));
    }
  }
  await Promise.all(tiles);

  // Everything else is drawn in layout pixels, scaled up so it stays sharp.
  ctx.scale(IMAGE_SCALE, IMAGE_SCALE);

  // Route, styled as on the map: a white casing under each coloured line.
  const toPx = (lat: number, lng: number): [number, number] => {
    const [x, y] = project(lat, lng, zoom);
    return [x - left, y - top];
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = (coords: [number, number][]) => {
    ctx.beginPath();
    coords.forEach(([lat, lng], i) => (i ? ctx.lineTo(...toPx(lat, lng)) : ctx.moveTo(...toPx(lat, lng))));
    ctx.stroke();
  };
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  // Line sizes are in map pixels; the context is scaled by IMAGE_SCALE, so convert to IMAGE_LINE_SCALE.
  const line = IMAGE_LINE_SCALE / IMAGE_SCALE;
  ctx.lineWidth = 9 * line;
  for (const seg of segments) stroke(seg.coords);
  ctx.lineWidth = 5 * line;
  for (const seg of segments) {
    const style = CATEGORIES[seg.category];
    ctx.strokeStyle = style.color;
    ctx.setLineDash(style.dashed ? [8 * line, 8 * line] : []);
    stroke(seg.coords);
  }
  ctx.setLineDash([]);

  const [start, end] = [waypoints[0], waypoints[waypoints.length - 1]];
  if (loop) drawMarker(ctx, ...toPx(start.lat, start.lng), 'S/E');
  else {
    if (waypoints.length > 1) drawMarker(ctx, ...toPx(end.lat, end.lng), 'E');
    drawMarker(ctx, ...toPx(start.lat, start.lng), 'S');
  }

  // Attribution, as the tile usage policy requires.
  const credit = '© OpenStreetMap contributors';
  ctx.font = '11px system-ui, sans-serif';
  const textWidth = ctx.measureText(credit).width;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fillRect(width - textWidth - 10, height - 18, textWidth + 10, 18);
  ctx.fillStyle = '#333';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(credit, width - 5, height - 9);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create the image'))), 'image/png'),
  );
}
