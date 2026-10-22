<script lang="ts">
  import { CATEGORIES, CATEGORY_ORDER } from './categories';
  import { DIRECT_SPEED_KMH } from './config';
  import SearchBox from './SearchBox.svelte';
  import { planner } from './state.svelte';
  import { loadRoutes, saveRoutes, type SavedRoute, type Waypoint } from './storage';

  let saved = $state.raw<SavedRoute[]>(loadRoutes());
  let routeName = $state('');
  let saveError = $state('');
  let optimiseResult = $state('');

  const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
  const duration = (s: number) => {
    const mins = Math.round(s / 60);
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
  };
  const wpLabel = (wp: Waypoint) => wp.label ?? `${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}`;

  function save(e: SubmitEvent) {
    e.preventDefault();
    const name = routeName.trim() || `Route ${new Date().toLocaleString()}`;
    const next = [planner.toSaved(name), ...saved];
    if (saveRoutes(next)) {
      saved = next;
      routeName = '';
      saveError = '';
    } else {
      saveError = 'Could not save — browser storage is unavailable or full.';
    }
  }

  function remove(route: SavedRoute) {
    if (!confirm(`Delete "${route.name}"?`)) return;
    const next = saved.filter((r) => r.id !== route.id);
    if (saveRoutes(next)) saved = next;
  }

  async function optimise() {
    optimiseResult = '';
    const removed = await planner.optimise();
    optimiseResult = removed ? `Removed ${removed} unneeded waypoint${removed === 1 ? '' : 's'}.` : 'No waypoints could be removed.';
  }

  const routeDistance = (r: SavedRoute) => r.legs.reduce((sum, l) => sum + l.distanceM, 0);
</script>

<aside>
  <h1>Bike Route Planner</h1>

  <section>
    <SearchBox />
    <p class="muted hint">
      {planner.waypoints.length === 0
        ? 'Click the map to set the start / meeting point.'
        : 'Click the map to add waypoints. Drag markers to move them.'}
    </p>
  </section>

  {#if planner.waypoints.length}
    <section>
      <h2>Route</h2>
      <ol class="waypoints">
        {#each planner.waypoints as wp, i (wp.id)}
          <li>
            <span class="badge" class:start={i === 0}>{i === 0 ? 'S' : i}</span>
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
        <form class="row" onsubmit={save}>
          <input placeholder="Route name" bind:value={routeName} />
          <button type="submit">Save</button>
        </form>
        {#if saveError}<p class="error">{saveError}</p>{/if}
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
              <span class="muted">· {km(routeDistance(route))} · {new Date(route.createdAt).toLocaleDateString()}</span>
            </span>
            <button onclick={() => planner.load(route)}>Load</button>
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
  .row input {
    flex: 1;
    min-width: 0;
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
</style>
