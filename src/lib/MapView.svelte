<script lang="ts">
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { CATEGORIES, CATEGORY_ORDER } from './categories';
  import { DEFAULT_CENTER, DEFAULT_ZOOM, MOBILE_QUERY, NOTICE_MS, TILE_URL } from './config';
  import { planner } from './state.svelte';
  import { theme, toggleDark } from './theme.svelte';

  // All Leaflet usage lives in this component so the map library can be swapped later.
  let container: HTMLDivElement;
  let map: L.Map | undefined = $state();
  const markerLayer = L.layerGroup();
  const routeLayer = L.layerGroup();
  // Folded by default on mobile, where the open legend covers much of the map.
  let legendOpen = $state(!matchMedia(MOBILE_QUERY).matches);
  // The rows' natural width; folding animates the legend between it and the toggle's width.
  let legendRowsWidth = $state(0);
  let fitButton: HTMLAnchorElement | undefined = $state();

  // Everything drawn on the map: waypoints plus the routed line of each leg.
  function contentPoints(): [number, number][] {
    const pts: [number, number][] = planner.waypoints.map((w) => [w.lat, w.lng]);
    for (const leg of planner.legs) for (const seg of leg.result?.segments ?? []) pts.push(...seg.coords);
    return pts;
  }

  onMount(() => {
    const m = L.map(container).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Routing <a href="https://brouter.de">BRouter</a>',
    }).addTo(m);
    routeLayer.addTo(m);
    markerLayer.addTo(m);

    const updateView = () => {
      const b = m.getBounds();
      planner.view = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    };
    m.on('moveend', updateView);
    // Leaflet closes an open popup on preclick but still fires click; don't treat that dismissal as a new waypoint.
    let popupOpen = false;
    let dismissing = false;
    m.on('popupopen', () => (popupOpen = true));
    m.on('popupclose', () => (popupOpen = false));
    m.on('preclick', () => (dismissing = popupOpen));
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (dismissing) {
        dismissing = false;
        return;
      }
      planner.addWaypoint(e.latlng.lat, e.latlng.lng);
    });
    // Right-click adds a waypoint reached by a direct (straight line) leg.
    m.on('contextmenu', (e: L.LeafletMouseEvent) => {
      L.DomEvent.preventDefault(e.originalEvent);
      planner.addWaypoint(e.latlng.lat, e.latlng.lng, undefined, 'direct');
    });
    // Zoom to fit sits in the zoom control's bar, under zoom in and out.
    fitButton = L.DomUtil.create('a', 'zoom-fit', m.zoomControl.getContainer());
    fitButton.href = '#';
    fitButton.role = 'button';
    fitButton.title = 'Zoom to fit route';
    fitButton.setAttribute('aria-label', 'Zoom to fit route');
    fitButton.innerHTML =
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.75"/></svg>';
    L.DomEvent.disableClickPropagation(fitButton);
    L.DomEvent.on(fitButton, 'click', (e) => {
      L.DomEvent.preventDefault(e);
      const pts = contentPoints();
      if (pts.length) planner.focus = pts;
    });
    updateView();
    map = m;
    // Leaflet only tracks window resizes; folding the planner on mobile resizes the map on its own.
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(container);
    // On mobile the planner's tab overlaps the bottom of the map, so the attribution moves to the top.
    const mobile = matchMedia(MOBILE_QUERY);
    const placeAttribution = () => m.attributionControl.setPosition(mobile.matches ? 'topright' : 'bottomright');
    placeAttribution();
    mobile.addEventListener('change', placeAttribution);
    return () => {
      mobile.removeEventListener('change', placeAttribution);
      resize.disconnect();
      m.remove();
    };
  });

  // Markers
  $effect(() => {
    markerLayer.clearLayers();
    const loop = planner.loop;
    const count = planner.waypoints.length;
    planner.waypoints.forEach((wp, i) => {
      // The end of a loop sits under the start marker, which stands for both.
      if (loop && i === count - 1) return;
      const isStart = i === 0;
      const isEnd = !isStart && i === count - 1;
      // Clicking the start closes the route into a loop, once there is somewhere to loop from.
      const closesLoop = isStart && !loop && count > 1;
      const icon = L.divIcon({
        className: '',
        html: `<div class="wp-marker${isStart || isEnd ? ' start' : ''}${isStart && loop ? ' loop' : ''}">${isStart ? (loop ? 'S/E' : 'S') : isEnd ? 'E' : i}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -13],
      });
      // Left-click only offers removal, so a press that was meant as a drag can't delete the point.
      const removeBtn = L.DomUtil.create('button', 'wp-remove');
      removeBtn.type = 'button';
      removeBtn.textContent = isStart && loop ? 'Remove end?' : 'Remove?';
      removeBtn.onclick = () => planner.removeWaypoint(wp.id);
      const name = isStart ? (loop ? 'Start / end point' : 'Start / meeting point') : isEnd ? 'End point' : `Waypoint ${i}`;
      const marker = L.marker([wp.lat, wp.lng], { icon, draggable: true })
        .bindTooltip(
          closesLoop
            ? `${name} — drag to move, click to return here at the end, right-click to remove`
            : `${name} — drag to move, click for options, right-click to remove${loop && isStart ? ' the end' : ''}`,
        )
        .on('popupopen', () => marker.closeTooltip())
        .on('dragstart', () => marker.closePopup())
        .on('dragend', () => {
          const ll = marker.getLatLng();
          // Put the marker back if the move was refused.
          if (!planner.moveWaypoint(wp.id, ll.lat, ll.lng)) marker.setLatLng([wp.lat, wp.lng]);
        })
        .on('contextmenu', (e: L.LeafletMouseEvent) => {
          L.DomEvent.preventDefault(e.originalEvent);
          planner.removeWaypoint(wp.id);
        });
      if (closesLoop) marker.on('click', () => planner.closeLoop());
      else marker.bindPopup(removeBtn, { closeButton: false, className: 'wp-popup' });
      markerLayer.addLayer(marker);
    });
  });

  // Route lines
  $effect(() => {
    routeLayer.clearLayers();
    planner.legs.forEach((leg, i) => {
      if (leg.result) {
        for (const seg of leg.result.segments) {
          const style = CATEGORIES[seg.category];
          L.polyline(seg.coords, { color: '#fff', weight: 9, opacity: 0.8, interactive: false }).addTo(routeLayer);
          L.polyline(seg.coords, {
            color: style.color,
            weight: 5,
            dashArray: style.dashed ? '8 8' : undefined,
            interactive: false,
          }).addTo(routeLayer);
        }
      } else {
        // Placeholder while routing, or on error.
        const a = planner.waypoints[i];
        const b = planner.waypoints[i + 1];
        if (!a || !b) return;
        L.polyline(
          [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ],
          {
            color: leg.status === 'error' ? '#d62728' : '#999',
            weight: 3,
            dashArray: '4 6',
            interactive: false,
            className: leg.status === 'loading' ? 'route-loading' : undefined,
          },
        ).addTo(routeLayer);
      }
    });
  });

  // Each new notice shows for NOTICE_MS, restarting the timer if one is already showing.
  let noticeText = $state('');
  $effect(() => {
    const n = planner.notice;
    if (!n) return;
    noticeText = n.text;
    const t = setTimeout(() => (noticeText = ''), NOTICE_MS);
    return () => clearTimeout(t);
  });

  // Nothing to fit until there is a waypoint.
  $effect(() => {
    const empty = !planner.waypoints.length;
    fitButton?.classList.toggle('leaflet-disabled', empty);
    fitButton?.setAttribute('aria-disabled', String(empty));
  });

  // Zoom to requested points
  $effect(() => {
    const pts = planner.focus;
    if (!map || !pts?.length) return;
    if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 15));
    else map.fitBounds(pts, { padding: [40, 40] });
  });
</script>

<div class="map-wrap">
  <div class="map" bind:this={container}></div>
  <div class="notice-wrap" role="status">
    {#if noticeText}<div class="notice" transition:fade={{ duration: 200 }}>{noticeText}</div>{/if}
  </div>
  <button class="theme-toggle" aria-label="Dark mode" aria-pressed={theme.dark} title="Dark mode" onclick={toggleDark}>
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill={theme.dark ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5" />
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
    cursor: crosshair;
    background: var(--map-bg);
  }
  /* Only the base tiles are filtered (darkened in dark mode); routes and markers keep their colours. */
  .map :global(.leaflet-tile-pane) {
    filter: var(--tile-filter);
  }
  .map :global(.leaflet-bar a),
  .map :global(.leaflet-popup-content-wrapper),
  .map :global(.leaflet-popup-tip),
  .map :global(.leaflet-tooltip) {
    background: var(--bg);
    color: var(--fg);
  }
  .map :global(.leaflet-bar a:hover) {
    background: var(--button-hover);
  }
  .map :global(.leaflet-bar a),
  .map :global(.leaflet-tooltip) {
    border-color: var(--border);
  }
  /* Restates Leaflet's disabled look, which the theme colours above would otherwise hide. */
  .map :global(.leaflet-bar a.leaflet-disabled) {
    background: var(--button-bg);
    color: var(--border);
    cursor: default;
  }
  .map :global(.zoom-fit) {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .map :global(.leaflet-control-attribution) {
    background: var(--overlay-bg);
    color: var(--fg);
  }
  .map :global(.leaflet-control-attribution a) {
    color: inherit;
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
  }
  .notice {
    background: var(--overlay-bg);
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
    text-align: center;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .theme-toggle {
    position: absolute;
    top: 10px;
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
  .theme-toggle:hover {
    background: var(--bg);
  }
  /* Clear of the planner's tab, which overlaps the bottom of the map on mobile. */
  @media (max-width: 700px) {
    .legend {
      bottom: 36px;
    }
    /* Below the attribution, which moves to the top right on mobile. */
    .theme-toggle,
    .notice-wrap {
      top: 28px;
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
  /* Marching-ants placeholder while a leg is routing; offset shifts by one dash period (4 + 6). */
  :global(.route-loading) {
    animation: route-ants 0.5s linear infinite;
  }
  @keyframes -global-route-ants {
    to {
      stroke-dashoffset: -10;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.route-loading) {
      animation: none;
    }
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
  }
  :global(.wp-marker.start) {
    background: var(--danger);
  }
  :global(.wp-marker.loop) {
    font-size: 9px;
  }
  :global(.wp-popup .leaflet-popup-content) {
    margin: 6px;
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
