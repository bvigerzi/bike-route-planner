<script lang="ts">
  import {
    AttributionControl,
    LngLatBounds,
    Map as MapLibreMap,
    Marker,
    Popup,
    setWorkerUrl,
    type GeoJSONSource,
    type IControl,
    type StyleSpecification,
    type TransformStyleFunction,
  } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { CATEGORIES, CATEGORY_ORDER } from './categories';
  import { DEFAULT_CENTER, DEFAULT_ZOOM, DOUBLE_TAP_MS, MAP_STYLE_DARK, MAP_STYLE_LIGHT, MOBILE_QUERY, NOTICE_MS } from './config';
  import { optimiseResultText, planner } from './state.svelte';
  import { undoShortcutLabel } from './shortcuts';
  import { theme, toggleDark } from './theme.svelte';

  // All MapLibre usage lives in this component so the map library can be swapped later.
  // MapLibre looks for its worker beside its own module, which bundling moves; point it at the bundled copy.
  setWorkerUrl(workerUrl);
  // The rest of the app uses [lat, lng]; MapLibre takes [lng, lat].
  const toLngLat = ([lat, lng]: [number, number]): [number, number] => [lng, lat];

  let container: HTMLDivElement;
  let map: MapLibreMap | undefined = $state();
  let markers: Marker[] = [];
  // Folded by default on mobile, where the open legend covers much of the map.
  let legendOpen = $state(!matchMedia(MOBILE_QUERY).matches);
  // The rows' natural width; folding animates the legend between it and the toggle's width.
  let legendRowsWidth = $state(0);
  let fitButton: HTMLButtonElement | undefined = $state();

  // Everything drawn on the map: waypoints plus the routed line of each leg.
  function contentPoints(): [number, number][] {
    const pts: [number, number][] = planner.waypoints.map((w) => [w.lat, w.lng]);
    for (const leg of planner.legs) for (const seg of leg.result?.segments ?? []) pts.push(...seg.coords);
    return pts;
  }

  // Route lines are one GeoJSON source. A routed segment has kind 'seg'; a leg still routing, or failed,
  // is drawn as a straight 'placeholder' from waypoint to waypoint.
  type RouteFeature = {
    type: 'Feature';
    properties: { kind: 'seg' | 'placeholder'; color: string; dashed: boolean; loading: boolean };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  };
  let routeData: { type: 'FeatureCollection'; features: RouteFeature[] } = { type: 'FeatureCollection', features: [] };

  // Dash lengths are in multiples of the line's width: 8px dashes on the 5px line, 4px dashes and 6px gaps on the 3px placeholder.
  const ROUTE_DASH = [1.6, 1.6];
  const PLACEHOLDER_WIDTH = 3;
  const PLACEHOLDER_DASH = [4 / PLACEHOLDER_WIDTH, 6 / PLACEHOLDER_WIDTH];
  // Marching ants while a leg is routing: the placeholder's 4px dash steps 1px along its 10px period each frame.
  // A dash array must start with a dash, so a shifted pattern starts with a zero-length one (invisible with butt caps).
  const ANT_FRAME_MS = 50;
  const ANT_STEPS = Array.from({ length: 10 }, (_, o) =>
    (o === 0 ? [4, 6] : o <= 6 ? [0, o, 4, 6 - o] : [o - 6, 6, 10 - o]).map((px) => px / PLACEHOLDER_WIDTH),
  );
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  const routeLayers: ReturnType<TransformStyleFunction>['layers'] = [
    // A white casing under every routed line, then the lines themselves.
    { id: 'route-casing', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'seg'], layout: round, paint: { 'line-color': '#fff', 'line-width': 9, 'line-opacity': 0.8 } },
    {
      id: 'route-solid',
      type: 'line',
      source: 'route',
      filter: ['all', ['==', ['get', 'kind'], 'seg'], ['!', ['get', 'dashed']]],
      layout: round,
      paint: { 'line-color': ['get', 'color'], 'line-width': 5 },
    },
    {
      id: 'route-dashed',
      type: 'line',
      source: 'route',
      filter: ['all', ['==', ['get', 'kind'], 'seg'], ['get', 'dashed']],
      layout: round,
      paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-dasharray': ROUTE_DASH },
    },
    {
      id: 'route-placeholder',
      type: 'line',
      source: 'route',
      filter: ['all', ['==', ['get', 'kind'], 'placeholder'], ['!', ['get', 'loading']]],
      paint: { 'line-color': ['get', 'color'], 'line-width': PLACEHOLDER_WIDTH, 'line-dasharray': PLACEHOLDER_DASH },
    },
    {
      id: 'route-loading',
      type: 'line',
      source: 'route',
      filter: ['all', ['==', ['get', 'kind'], 'placeholder'], ['get', 'loading']],
      paint: { 'line-color': ['get', 'color'], 'line-width': PLACEHOLDER_WIDTH, 'line-dasharray': PLACEHOLDER_DASH },
    },
  ];

  // Adds the route on top of a newly loaded base style, with whatever it shows at that moment, so it
  // survives the swap between the light and dark styles. 3D buildings are left out: they lean over the streets.
  const withRoute: TransformStyleFunction = (_previous, next) => ({
    ...next,
    sources: { ...next.sources, route: { type: 'geojson', data: routeData } },
    layers: [...next.layers.filter((l) => l.type !== 'fill-extrusion'), ...routeLayers],
  });
  const styleUrl = (dark: boolean) => (dark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT);
  // The theme whose style the map has (or is loading).
  let styleDark = theme.dark;
  // Both styles' JSON, fetched once the map first settles, so switching theme doesn't wait on the network.
  // Until a style has arrived, switching to it falls back to its URL.
  const prefetchedStyles: Record<string, StyleSpecification> = {};
  function prefetchStyle(url: string) {
    fetch(url)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((style) => {
        if (style) prefetchedStyles[url] = style;
      })
      .catch(() => {
        // Offline or blocked; the switch fetches the URL itself.
      });
  }

  // Zoom in, zoom out and zoom to fit, in one bar.
  function zoomControl(m: MapLibreMap): IControl {
    const bar = document.createElement('div');
    bar.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const button = (label: string, path: string, onclick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.75"/></svg>`;
      b.onclick = onclick;
      bar.append(b);
      return b;
    };
    button('Zoom in', 'M8 2v12M2 8h12', () => m.zoomIn());
    button('Zoom out', 'M2 8h12', () => m.zoomOut());
    fitButton = button('Zoom to fit route', 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4', () => {
      const pts = contentPoints();
      if (pts.length) planner.focus = pts;
    });
    return { onAdd: () => bar, onRemove: () => bar.remove() };
  }

  onMount(() => {
    const m = new MapLibreMap({
      container,
      center: toLngLat(DEFAULT_CENTER),
      zoom: DEFAULT_ZOOM,
      maxZoom: 19,
      // North stays up and the map stays flat, as for a paper map (and the exported image).
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false,
    });
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.setStyle(styleUrl(styleDark), { transformStyle: withRoute });
    // After the first style's tiles, so it doesn't compete with them.
    m.once('idle', () => {
      prefetchStyle(MAP_STYLE_LIGHT);
      prefetchStyle(MAP_STYLE_DARK);
    });
    m.addControl(zoomControl(m), 'top-left');

    const updateView = () => {
      const b = m.getBounds();
      planner.view = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    };
    m.on('moveend', updateView);
    // Clicks on a marker reach the map too (markers sit over its canvas); the marker handles those itself.
    const onMarker = (e: { originalEvent: Event }) => (e.originalEvent.target as Element).closest('.maplibregl-marker') !== null;
    // A click on the map closes an open popup and is still a map click; don't treat that dismissal as a new waypoint.
    let dismissing = false;
    // A double tap zooms, so on touch a tap waits to see whether a second follows before adding its waypoint.
    // Mouse clicks add at once, as a double click is rarely meant as a zoom there.
    // The second tap is caught as it lands, since MapLibre's double-tap zoom often stops it becoming a click.
    let lastPointerType = '';
    let pendingTap: ReturnType<typeof setTimeout> | undefined;
    let secondTap = false;
    const onPointerDown = (e: PointerEvent) => {
      lastPointerType = e.pointerType;
      dismissing = markers.some((mk) => mk.getPopup()?.isOpen());
      // The second tap of a double tap: neither tap adds a waypoint.
      secondTap = pendingTap !== undefined;
      clearTimeout(pendingTap);
      pendingTap = undefined;
    };
    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    m.on('click', (e) => {
      if (onMarker(e)) return;
      if (dismissing) {
        dismissing = false;
        return;
      }
      if (lastPointerType !== 'touch') {
        planner.addWaypoint(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      if (secondTap) return;
      pendingTap = setTimeout(() => {
        pendingTap = undefined;
        planner.addWaypoint(e.lngLat.lat, e.lngLat.lng);
      }, DOUBLE_TAP_MS);
    });
    // Right-click adds a waypoint reached by a direct (straight line) leg.
    m.on('contextmenu', (e) => {
      e.preventDefault();
      e.originalEvent.preventDefault();
      if (!onMarker(e)) planner.addWaypoint(e.lngLat.lat, e.lngLat.lng, undefined, 'direct');
    });
    updateView();
    map = m;
    // On mobile the full credits would wrap over the controls, so they fold behind an (i) button in the bottom
    // left, clear of the planner's tab. A control's options are fixed once added, so it is replaced to switch.
    const mobile = matchMedia(MOBILE_QUERY);
    let attribution: AttributionControl | undefined;
    const placeAttribution = () => {
      if (attribution) m.removeControl(attribution);
      attribution = new AttributionControl({ compact: mobile.matches, customAttribution: 'Routing <a href="https://brouter.de">BRouter</a>' });
      m.addControl(attribution, mobile.matches ? 'bottom-left' : 'bottom-right');
    };
    placeAttribution();
    mobile.addEventListener('change', placeAttribution);
    return () => {
      mobile.removeEventListener('change', placeAttribution);
      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
      clearTimeout(pendingTap);
      m.remove();
    };
  });

  // Base map style, following the theme
  $effect(() => {
    const dark = theme.dark;
    const m = map;
    if (!m || dark === styleDark) return;
    styleDark = dark;
    const url = styleUrl(dark);
    const prefetched = prefetchedStyles[url];
    // A copy, as MapLibre may hold on to (or alter) the object it is given, and the cached one is reused.
    m.setStyle(prefetched ? structuredClone(prefetched) : url, { transformStyle: withRoute });
  });

  // Markers
  $effect(() => {
    const m = map;
    if (!m) return;
    const loop = planner.loop;
    const count = planner.waypoints.length;
    planner.waypoints.forEach((wp, i) => {
      // The end of a loop sits under the start marker, which stands for both.
      if (loop && i === count - 1) return;
      const isStart = i === 0;
      const isEnd = !isStart && i === count - 1;
      // Clicking the start closes the route into a loop, once there is somewhere to loop from.
      const closesLoop = isStart && !loop && count > 1;
      const el = document.createElement('div');
      el.className = `wp-marker${isStart || isEnd ? ' start' : ''}${isStart && loop ? ' loop' : ''}`;
      el.textContent = isStart ? (loop ? 'S/E' : 'S') : isEnd ? 'E' : `${i}`;
      const name = isStart ? (loop ? 'Start / end point' : 'Start / meeting point') : isEnd ? 'End point' : `Waypoint ${i}`;
      el.title = closesLoop
        ? `${name} — drag to move, click to return here at the end, right-click to remove`
        : `${name} — drag to move, click for options, right-click to remove${loop && isStart ? ' the end' : ''}`;
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        planner.removeWaypoint(wp.id);
      });
      const marker = new Marker({ element: el, draggable: true }).setLngLat([wp.lng, wp.lat]);
      marker.on('dragstart', () => marker.getPopup()?.remove());
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        // Put the marker back if the move was refused.
        if (!planner.moveWaypoint(wp.id, ll.lat, ll.lng)) marker.setLngLat([wp.lng, wp.lat]);
      });
      if (closesLoop) marker.on('click', () => planner.closeLoop());
      else {
        // Left-click only offers removal, so a press that was meant as a drag can't delete the point.
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'wp-remove';
        removeBtn.textContent = isStart && loop ? 'Remove end?' : 'Remove?';
        removeBtn.onclick = () => planner.removeWaypoint(wp.id);
        marker.setPopup(new Popup({ closeButton: false, offset: 13, className: 'wp-popup' }).setDOMContent(removeBtn));
      }
      markers.push(marker.addTo(m));
    });
    return () => {
      for (const marker of markers) marker.remove();
      markers = [];
    };
  });

  // Route lines
  $effect(() => {
    const features: RouteFeature[] = [];
    const line = (coords: [number, number][], props: RouteFeature['properties']) =>
      features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords.map(toLngLat) } });
    planner.legs.forEach((leg, i) => {
      if (leg.result) {
        for (const s of leg.result.segments) {
          const style = CATEGORIES[s.category];
          line(s.coords, { kind: 'seg', color: style.color, dashed: !!style.dashed, loading: false });
        }
      } else {
        // Placeholder while routing, or on error.
        const a = planner.waypoints[i];
        const b = planner.waypoints[i + 1];
        if (!a || !b) return;
        line(
          [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ],
          { kind: 'placeholder', color: leg.status === 'error' ? '#d62728' : '#999', dashed: true, loading: leg.status === 'loading' },
        );
      }
    });
    routeData = { type: 'FeatureCollection', features };
    // Missing while the first style loads; it then picks up routeData itself.
    (map?.getSource('route') as GeoJSONSource | undefined)?.setData(routeData);
  });

  // Marching ants on legs that are routing.
  $effect(() => {
    const m = map;
    const routing = planner.legs.some((l) => !l.result && l.status === 'loading');
    if (!m || !routing || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let step = 0;
    const timer = setInterval(() => {
      step = (step + 1) % ANT_STEPS.length;
      if (m.getLayer('route-loading')) m.setPaintProperty('route-loading', 'line-dasharray', ANT_STEPS[step]);
    }, ANT_FRAME_MS);
    return () => clearInterval(timer);
  });

  // Each new notice shows for NOTICE_MS, restarting the timer if one is already showing.
  let noticeText = $state('');
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function showNotice(text: string) {
    noticeText = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (noticeText = ''), NOTICE_MS);
  }
  $effect(() => {
    const n = planner.notice;
    if (n) showNotice(n.text);
  });
  $effect(() => () => clearTimeout(noticeTimer));

  // An optimise started here shows until it finishes, behind any notice it refuses an edit with.
  let optimisingHere = $state(false);
  const shownNotice = $derived(noticeText || (optimisingHere ? 'Optimising route…' : ''));

  // The planner, where optimise reports its result, may be folded or far from the button, so report it here too.
  async function optimise() {
    optimisingHere = true;
    const removed = await planner.optimise();
    // Swapped in the same update, so the notice doesn't flicker out between them.
    optimisingHere = false;
    showNotice(optimiseResultText(removed));
  }

  // Nothing to fit until there is a waypoint.
  $effect(() => {
    if (fitButton) fitButton.disabled = !planner.waypoints.length;
  });

  // Zoom to requested points
  $effect(() => {
    const pts = planner.focus;
    if (!map || !pts?.length) return;
    if (pts.length === 1) map.easeTo({ center: toLngLat(pts[0]), zoom: Math.max(map.getZoom(), 15) });
    else {
      const bounds = new LngLatBounds(toLngLat(pts[0]), toLngLat(pts[0]));
      for (const p of pts) bounds.extend(toLngLat(p));
      map.fitBounds(bounds, { padding: 40 });
    }
  });
</script>

<div class="map-wrap">
  <div class="map" bind:this={container}></div>
  <div class="notice-wrap" role="status">
    <!-- Keyed by text, so a change fades the old notice out as the new one fades in over it. -->
    {#each shownNotice ? [shownNotice] : [] as text (text)}
      <div class="notice" transition:fade={{ duration: 200 }}>{text}</div>
    {/each}
  </div>
  <button class="map-button theme-toggle" aria-label="Dark mode" aria-pressed={theme.dark} title="Dark mode" onclick={toggleDark}>
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill={theme.dark ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5" />
    </svg>
  </button>
  <!-- The planner's Undo, Clear and Optimise, kept to hand on the map: the planner is usually folded away on mobile, where stray taps are easier to make. -->
  <button
    class="map-button undo-button"
    aria-label="Undo"
    title="Revert the last change ({undoShortcutLabel()})"
    disabled={planner.optimising || !planner.canUndo}
    onclick={() => planner.undo()}
  >
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M5.5 3 2 6.5 5.5 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M2.5 6.5H10a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  </button>
  <button
    class="map-button clear-button"
    aria-label="Clear"
    title="Clear"
    disabled={planner.optimising || !planner.waypoints.length}
    onclick={() => planner.clear()}
  >
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.75 6.5v4.5M9.25 6.5v4.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>
  <button
    class="map-button optimise-button"
    aria-label="Optimise"
    title="Remove waypoints that don't change the route"
    disabled={planner.optimising || planner.waypoints.length < 3}
    aria-busy={planner.optimising}
    onclick={optimise}
  >
    <!-- A broom sweeping down-left, with a sparkle. -->
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M14 2 8.25 7.75M7 6.5 9.5 9 7.5 13.5 2.5 8.5ZM7.8 7.3 4.2 10.2M8.7 8.2 5.8 11.8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path d="M3.5 1 4.2 2.8 6 3.5 4.2 4.2 3.5 6 2.8 4.2 1 3.5 2.8 2.8Z" fill="currentColor" />
    </svg>
  </button>
  <div class="legend">
    <button class="legend-toggle" aria-expanded={legendOpen} aria-controls="legend-rows" onclick={() => (legendOpen = !legendOpen)}>
      Legend {legendOpen ? '▾' : '▴'}
    </button>
    <div
      id="legend-rows"
      class:folded={!legendOpen}
      style:width={legendRowsWidth ? `${legendOpen ? legendRowsWidth : 0}px` : undefined}
    >
      <div class="legend-inner" bind:offsetWidth={legendRowsWidth}>
        {#each CATEGORY_ORDER as cat}
          <div class="legend-row">
            <span
              class="swatch"
              style:background={CATEGORIES[cat].dashed
                ? // Three equal 5px dashes with two 3.5px gaps (fills the 22px swatch); border-radius rounds the outer ends.
                  `linear-gradient(to right, ${CATEGORIES[cat].color} 0 5px, transparent 5px 8.5px, ${CATEGORIES[cat].color} 8.5px 13.5px, transparent 13.5px 17px, ${CATEGORIES[cat].color} 17px)`
                : CATEGORIES[cat].color}
            ></span>
            {CATEGORIES[cat].label}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .map-wrap {
    position: relative;
    height: 100%;
  }
  .map {
    height: 100%;
    background: var(--map-bg);
  }
  /* A crosshair for placing points, instead of MapLibre's grab hand; it still grabs while panning. */
  .map :global(.maplibregl-canvas-container.maplibregl-interactive) {
    cursor: crosshair;
  }
  .map :global(.maplibregl-canvas-container.maplibregl-interactive:active) {
    cursor: grabbing;
  }
  .map :global(.maplibregl-ctrl-group),
  .map :global(.maplibregl-popup-content) {
    background: var(--bg);
    color: var(--fg);
  }
  .map :global(.maplibregl-ctrl-group button) {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: inherit;
  }
  .map :global(.maplibregl-ctrl-group button + button) {
    border-top-color: var(--border);
  }
  .map :global(.maplibregl-ctrl-group button:hover:not(:disabled)) {
    background: var(--button-hover);
  }
  .map :global(.maplibregl-ctrl-group button:disabled) {
    opacity: 1;
    color: var(--border);
  }
  /* The popup's tip is a border triangle, on the side facing the marker. */
  .map :global(.maplibregl-popup-anchor-top .maplibregl-popup-tip),
  .map :global(.maplibregl-popup-anchor-top-left .maplibregl-popup-tip),
  .map :global(.maplibregl-popup-anchor-top-right .maplibregl-popup-tip) {
    border-bottom-color: var(--bg);
  }
  .map :global(.maplibregl-popup-anchor-bottom .maplibregl-popup-tip),
  .map :global(.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip),
  .map :global(.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip) {
    border-top-color: var(--bg);
  }
  .map :global(.maplibregl-popup-anchor-left .maplibregl-popup-tip) {
    border-right-color: var(--bg);
  }
  .map :global(.maplibregl-popup-anchor-right .maplibregl-popup-tip) {
    border-left-color: var(--bg);
  }
  .map :global(.maplibregl-ctrl-attrib) {
    background: var(--overlay-bg);
    color: var(--fg);
  }
  .map :global(.maplibregl-ctrl-attrib a) {
    color: inherit;
  }
  /* The folded credits' (i) icon is drawn dark, so light it up in dark mode. */
  :global([data-theme='dark']) .map :global(.maplibregl-ctrl-attrib-button) {
    filter: invert(1);
  }
  .legend {
    position: absolute;
    right: 10px;
    bottom: 24px;
    z-index: 1000;
    background: var(--overlay-bg);
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 12px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .notice-wrap {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    width: max-content;
    max-width: calc(100% - 120px);
    pointer-events: none;
    display: grid;
    justify-items: center;
  }
  .notice {
    grid-area: 1 / 1;
    background: var(--overlay-bg);
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
    text-align: center;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .map-button {
    position: absolute;
    right: 10px;
    z-index: 1000;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: var(--overlay-bg);
    color: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .map-button:hover:not(:disabled) {
    background: var(--bg);
  }
  .map-button:disabled {
    color: var(--border);
    cursor: default;
  }
  .theme-toggle {
    top: 10px;
  }
  .undo-button {
    top: 50px;
  }
  .clear-button {
    top: 90px;
  }
  .optimise-button {
    top: 130px;
  }
  /* Clear of the planner's tab, which overlaps the bottom of the map on mobile. */
  @media (max-width: 700px) {
    .legend {
      bottom: 36px;
    }
  }
  .legend-toggle {
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font-size: 12px;
    font-weight: bold;
    text-align: left;
    white-space: nowrap;
  }
  .legend-toggle:hover {
    background: none;
  }
  /* Unfolds by animating its one row between 0fr and 1fr, so the height eases to fit the rows, and
     its width between 0 and the rows' measured width, so folded it shrinks to the toggle. */
  #legend-rows {
    display: grid;
    grid-template-rows: 1fr;
    overflow: hidden;
    transition:
      grid-template-rows 0.2s ease,
      width 0.2s ease,
      visibility 0s;
  }
  #legend-rows.folded {
    grid-template-rows: 0fr;
    visibility: hidden;
    transition:
      grid-template-rows 0.2s ease,
      width 0.2s ease,
      visibility 0s 0.2s;
  }
  .legend-inner {
    width: max-content;
    min-height: 0;
    overflow: hidden;
  }
  .legend-row {
    display: flex;
    align-items: center;
    gap: 6px;
    line-height: 1.6;
  }
  .swatch {
    display: inline-block;
    width: 22px;
    height: 4px;
    border-radius: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    #legend-rows,
    #legend-rows.folded {
      transition: none;
    }
  }
  :global(.wp-marker) {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--waypoint);
    color: #fff;
    border: 2px solid #fff;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    font: bold 12px system-ui, sans-serif;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
    cursor: pointer;
  }
  :global(.wp-marker.start) {
    background: var(--danger);
  }
  :global(.wp-marker.loop) {
    font-size: 9px;
  }
  :global(.wp-popup .maplibregl-popup-content) {
    padding: 6px;
  }
  :global(.wp-remove) {
    background: #c0392b;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    font: bold 12px system-ui, sans-serif;
    cursor: pointer;
  }
</style>
