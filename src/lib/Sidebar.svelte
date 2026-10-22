<script lang="ts">
  import { fade } from 'svelte/transition';
  import { CATEGORIES, CATEGORY_ORDER } from './categories';
  import { DIRECT_SPEED_KMH, URL_WARN_LENGTH } from './config';
  import { downloadGpx, toGpx } from './gpx';
  import { MAPS_APP_NAME, MAX_STOPS, mapsUrl, preferredMapsApp } from './mapsLink';
  import { decodeRoute, encodeRoute } from './routeUrl';
  import SearchBox from './SearchBox.svelte';
  import { planner } from './state.svelte';
  import { loadRoutes, saveRoutes, type SavedRoute, type Waypoint } from './storage';

  let saved = $state.raw<SavedRoute[]>(loadRoutes());
  let saveError = $state('');
  let optimiseResult = $state('');
  let copied = $state(false);
  let justSaved = $state(false);
  let justSavedTimer: ReturnType<typeof setTimeout> | undefined;

  const hash = $derived(encodeRoute(planner.toState()));
  // A route that has never been saved, or differs from its saved entry, has unsaved changes.
  const unsaved = $derived(saved.find((r) => r.id === planner.savedId)?.hash !== hash);
  const mapsApp = preferredMapsApp();
  const mapsHref = $derived(mapsUrl(mapsApp, planner.waypoints));
  const linkLength = $derived(location.origin.length + location.pathname.length + location.search.length + 1 + hash.length);

  const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
  const duration = (s: number) => {
    const mins = Math.round(s / 60);
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
  };
  const wpLabel = (wp: Waypoint) => wp.label ?? `${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}`;

  function save(e: SubmitEvent) {
    e.preventDefault();
    const asCopy = (e.submitter as HTMLButtonElement | null)?.value === 'copy';
    planner.name = planner.name.trim() || `Route ${new Date().toLocaleString()}`;
    const existing = asCopy ? undefined : saved.find((r) => r.id === planner.savedId);
    const route: SavedRoute = {
      id: existing?.id ?? crypto.randomUUID(),
      name: planner.name,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      hash: encodeRoute(planner.toState()),
      distanceM: planner.totals.distanceM,
    };
    // Editing replaces the saved entry in place; otherwise (or if it was deleted) add a new one.
    const next = existing ? saved.map((r) => (r.id === existing.id ? route : r)) : [route, ...saved];
    if (saveRoutes(next)) {
      saved = next;
      planner.savedId = route.id;
      saveError = '';
      justSaved = true;
      clearTimeout(justSavedTimer);
      justSavedTimer = setTimeout(() => (justSaved = false), 1000);
    } else {
      saveError = 'Could not save — browser storage is unavailable or full.';
    }
  }

  function remove(route: SavedRoute) {
    if (!confirm(`Delete "${route.name}"?`)) return;
    const next = saved.filter((r) => r.id !== route.id);
    if (saveRoutes(next)) {
      saved = next;
      if (planner.savedId === route.id) planner.savedId = null;
    }
  }

  function load(route: SavedRoute) {
    const state = decodeRoute(route.hash);
    if (state) planner.load(state, route.id);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}${location.search}#${hash}`);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context); the address bar still has the link.
    }
  }

  function exportGpx() {
    const legs = planner.legs.flatMap((l) => (l.result ? [l.result] : []));
    downloadGpx(planner.name || 'route', toGpx(planner.name, planner.waypoints, legs));
  }

  async function optimise() {
    optimiseResult = '';
    const removed = await planner.optimise();
    optimiseResult = removed ? `Removed ${removed} unneeded waypoint${removed === 1 ? '' : 's'}.` : 'No waypoints could be removed.';
  }
</script>

<aside>
  <h1>Bike Route Planner</h1>

  <section>
    <SearchBox />
    <p class="muted hint">
      {planner.waypoints.length === 0
        ? 'Click the map to set the start / meeting point.'
        : 'Click the map to add waypoints, or right-click to add one reached by a direct line. Drag markers to move them; click the start to return to it at the end.'}
    </p>
  </section>

  {#if planner.waypoints.length}
    <section>
      <h2>Route</h2>
      <input class="name" placeholder="Route name" bind:value={planner.name} />
      <ol class="waypoints">
        {#each planner.waypoints as wp, i (wp.id)}
          {@const isEnd = planner.loop && i === planner.waypoints.length - 1}
          <li>
            <span class="badge" class:start={i === 0 || isEnd}>{i === 0 ? 'S' : isEnd ? 'E' : i}</span>
            <span class="wp-label">{wpLabel(wp)}</span>
            <button class="icon" title="Remove" onclick={() => planner.removeWaypoint(wp.id)}>×</button>
          </li>
          {#if i < planner.waypoints.length - 1}
            {@const leg = planner.legs[i]}
            <li class="leg">
              <button
                class="toggle"
                class:direct={planner.legModes[i] === 'direct'}
                title="Direct ignores the router and draws a straight line (local knowledge override)"
                onclick={() => planner.toggleLeg(i)}
              >
                {planner.legModes[i] === 'direct' ? 'Direct' : 'Route'}
              </button>
              {#if leg?.status === 'loading'}
                <span class="muted">routing…</span>
              {:else if leg?.status === 'error'}
                <span class="error" title={leg.error}>routing failed — try Direct or move a point</span>
              {:else if leg?.result}
                <span class="muted">{km(leg.result.distanceM)}</span>
              {/if}
            </li>
          {/if}
        {/each}
      </ol>
      <div class="row">
        <button disabled={planner.optimising} onclick={() => planner.undo()}>Undo last</button>
        <button disabled={planner.optimising} onclick={() => planner.clear()}>Clear</button>
        <button
          disabled={planner.optimising || planner.waypoints.length < 3}
          title="Remove waypoints that don't change the route"
          onclick={optimise}
        >
          {planner.optimising ? 'Optimising…' : 'Optimise'}
        </button>
      </div>
      {#if optimiseResult}<p class="muted hint">{optimiseResult}</p>{/if}
      {#if linkLength > URL_WARN_LENGTH}
        <p class="error">Link is {linkLength} characters — some apps may truncate it. Try Optimise to remove waypoints.</p>
      {/if}
    </section>
  {/if}

  {#if planner.legs.length}
    <section>
      <h2>Summary</h2>
      {#if planner.totals.loading}<p class="muted">Routing…</p>{/if}
      <div class="stats">
        <div><strong>{km(planner.totals.distanceM)}</strong><span>distance</span></div>
        <div><strong>{duration(planner.totals.timeS)}</strong><span>est. time</span></div>
        <div><strong>{Math.round(planner.totals.ascentM)} m</strong><span>ascent</span></div>
      </div>
      <ul class="breakdown">
        {#each CATEGORY_ORDER as cat}
          {#if planner.totals.byCategory[cat] > 0}
            <li>
              <span class="swatch" style:background={CATEGORIES[cat].color}></span>
              {CATEGORIES[cat].label}
              <span class="muted">
                {km(planner.totals.byCategory[cat])}
                ({Math.round((planner.totals.byCategory[cat] / planner.totals.distanceM) * 100)}%)
              </span>
            </li>
          {/if}
        {/each}
      </ul>
      {#if planner.legModes.includes('direct')}
        <p class="muted hint">Direct legs estimated at {DIRECT_SPEED_KMH} km/h.</p>
      {/if}

      {#if planner.totals.complete}
        {#if unsaved}
          <p class="error">Unsaved changes</p>
        {:else if justSaved}
          <p class="success" transition:fade={{ duration: 200 }}>Changes saved successfully!</p>
        {/if}
        <form class="row" onsubmit={save}>
          {#if planner.savedId}
            <button type="submit" title="Update the saved route" disabled={!unsaved}>Save</button>
            <button type="submit" value="copy" title="Save this route as a new entry, leaving the original unchanged">
              Save as copy
            </button>
          {:else}
            <button type="submit" title="Keep a link to this route in this browser">Save</button>
          {/if}
          <button type="button" title="Copy a link to this route to share" onclick={copyLink}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </form>
        {#if saveError}<p class="error">{saveError}</p>{/if}
        <div class="row nav">
          {#if mapsHref}
            <a
              class="button"
              href={mapsHref}
              target="_blank"
              rel="noopener"
              title="Cycling directions in {MAPS_APP_NAME[mapsApp]}, with each waypoint as a stop. Direct legs are routed by the app."
            >
              Open in maps
            </a>
          {:else}
            <button type="button" disabled>Open in maps</button>
          {/if}
          <button type="button" title="Download the route as a GPX file for bike apps such as Komoot, Strava or Garmin" onclick={exportGpx}>
            Download GPX
          </button>
        </div>
        {#if !mapsHref}
          <p class="error">
            {MAPS_APP_NAME[mapsApp]} allows up to {MAX_STOPS[mapsApp]} stops (this route has {planner.waypoints.length - 2}).
            Try Optimise, or Download GPX for a bike app.
          </p>
        {/if}
      {/if}
    </section>
  {/if}

  {#if saved.length}
    <section>
      <h2>Saved routes</h2>
      <ul class="saved">
        {#each saved as route (route.id)}
          <li>
            <span class="wp-label">
              {route.name}
              <span class="muted">· {km(route.distanceM)} · {new Date(route.createdAt).toLocaleDateString()}</span>
            </span>
            <button onclick={() => load(route)}>Load</button>
            <button class="icon" title="Delete" onclick={() => remove(route)}>×</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</aside>

<style>
  aside {
    padding: 12px 16px;
    overflow-y: auto;
    height: 100%;
    box-sizing: border-box;
  }
  h1 {
    font-size: 18px;
    margin: 0 0 12px;
  }
  h2 {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #555;
    margin: 0 0 8px;
  }
  section {
    padding: 12px 0;
    border-top: 1px solid #e5e5e5;
  }
  section:first-of-type {
    border-top: none;
    padding-top: 0;
  }
  .hint {
    font-size: 12px;
    margin: 6px 0 0;
  }
  .waypoints,
  .saved,
  .breakdown {
    list-style: none;
    padding: 0;
    margin: 0 0 8px;
  }
  .waypoints li,
  .saved li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    font-size: 13px;
  }
  .leg {
    padding-left: 34px !important;
  }
  .wp-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #2c3e50;
    color: #fff;
    font-size: 11px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .badge.start {
    background: #c0392b;
  }
  .toggle {
    font-size: 11px;
    padding: 1px 8px;
  }
  .toggle.direct {
    background: #8e44ad;
    color: #fff;
    border-color: #8e44ad;
  }
  .icon {
    border: none;
    background: none;
    font-size: 16px;
    cursor: pointer;
    color: #888;
    padding: 0 4px;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row.nav {
    margin-top: 6px;
  }
  /* A link (so mobile opens the maps app) that looks like the buttons beside it. */
  a.button {
    font-size: 13px;
    padding: 4px 10px;
    border: 1px solid #bbb;
    border-radius: 4px;
    background: #f7f7f7;
    color: inherit;
    text-decoration: none;
  }
  a.button:hover {
    background: #eee;
  }
  .name {
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 8px;
  }
  .stats {
    display: flex;
    gap: 16px;
    margin-bottom: 10px;
  }
  .stats div {
    display: flex;
    flex-direction: column;
  }
  .stats strong {
    font-size: 18px;
  }
  .stats span {
    font-size: 11px;
    color: #777;
  }
  .breakdown li {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    line-height: 1.7;
  }
  .swatch {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 2px;
  }
  .error {
    color: #c0392b;
    font-size: 12px;
  }
  .success {
    color: #27ae60;
    font-size: 12px;
  }
</style>
