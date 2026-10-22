<script lang="ts">
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { onMount } from 'svelte';
  import { CATEGORIES, CATEGORY_ORDER } from './categories';
  import { DEFAULT_CENTER, DEFAULT_ZOOM } from './config';
  import { planner } from './state.svelte';

  // All Leaflet usage lives in this component so the map library can be swapped later.
  let container: HTMLDivElement;
  let map: L.Map | undefined = $state();
  const markerLayer = L.layerGroup();
  const routeLayer = L.layerGroup();

  onMount(() => {
    const m = L.map(container).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
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
    updateView();
    map = m;
    return () => m.remove();
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
      // Clicking the start closes the route into a loop, once there is somewhere to loop from.
      const closesLoop = isStart && !loop && count > 1;
      const icon = L.divIcon({
        className: '',
        html: `<div class="wp-marker${isStart ? ' start' : ''}${isStart && loop ? ' loop' : ''}">${isStart ? (loop ? 'S/E' : 'S') : i}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -13],
      });
      // Left-click only offers removal, so a press that was meant as a drag can't delete the point.
      const removeBtn = L.DomUtil.create('button', 'wp-remove');
      removeBtn.type = 'button';
      removeBtn.textContent = isStart && loop ? 'Remove end?' : 'Remove?';
      removeBtn.onclick = () => planner.removeWaypoint(wp.id);
      const name = isStart ? (loop ? 'Start / end point' : 'Start / meeting point') : `Waypoint ${i}`;
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
          planner.moveWaypoint(wp.id, ll.lat, ll.lng);
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
  <div class="legend">
    {#each CATEGORY_ORDER as cat}
      <div class="legend-row">
        <span
          class="swatch"
          style:background={CATEGORIES[cat].dashed ? 'none' : CATEGORIES[cat].color}
          style:border-top={CATEGORIES[cat].dashed ? `3px dashed ${CATEGORIES[cat].color}` : 'none'}
        ></span>
        {CATEGORIES[cat].label}
      </div>
    {/each}
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
  }
  .legend {
    position: absolute;
    right: 10px;
    bottom: 24px;
    z-index: 1000;
    background: rgba(255, 255, 255, 0.92);
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 12px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
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
  }
  :global(.wp-marker) {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #2c3e50;
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
    background: #c0392b;
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
