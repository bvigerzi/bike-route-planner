<script lang="ts">
  import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_CHARS } from './config';
  import { searchPlaces, type Place } from './geocode';
  import { planner } from './state.svelte';

  let query = $state('');
  let results = $state<Place[]>([]);
  let status = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: AbortController | undefined;

  async function run(q: string) {
    clearTimeout(timer);
    inflight?.abort();
    const ctrl = (inflight = new AbortController());
    status = 'Searching…';
    try {
      const found = await searchPlaces(q, planner.view, ctrl.signal);
      if (ctrl !== inflight) return;
      results = found;
      status = found.length ? '' : 'No results';
    } catch (err) {
      if (ctrl !== inflight) return;
      results = [];
      status = (err as Error).message;
    }
  }

  /** Search as you type, once typing pauses. */
  function oninput() {
    clearTimeout(timer);
    const q = query.trim();
    if (q.length < SEARCH_MIN_CHARS) {
      inflight?.abort();
      results = [];
      status = '';
      return;
    }
    timer = setTimeout(() => run(q), SEARCH_DEBOUNCE_MS);
  }

  /** Enter searches straight away. */
  function search(e: SubmitEvent) {
    e.preventDefault();
    if (query.trim()) void run(query.trim());
  }

  function pick(place: Place, asStart: boolean) {
    const label = place.label.split(',').slice(0, 2).join(',');
    if (asStart) planner.setStart(place.lat, place.lng, label);
    else planner.addWaypoint(place.lat, place.lng, label);
    planner.focus = [[place.lat, place.lng]];
    clearTimeout(timer);
    inflight?.abort();
    results = [];
    status = '';
    query = '';
  }
</script>

<form onsubmit={search}>
  <input type="search" placeholder="Search a place or address…" bind:value={query} {oninput} />
  <button type="submit">Search</button>
</form>
{#if status}<p class="muted">{status}</p>{/if}
{#if results.length}
  <ul class="results">
    {#each results as place}
      <li>
        <span class="label">{place.label}</span>
        <span class="actions">
          <button onclick={() => pick(place, true)}>Set start</button>
          <button onclick={() => pick(place, false)}>Add</button>
        </span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  form {
    display: flex;
    gap: 6px;
  }
  input {
    flex: 1;
    min-width: 0;
  }
  .results {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
  }
  .results li {
    padding: 6px 0;
    border-bottom: 1px solid var(--divider);
    font-size: 13px;
  }
  .label {
    display: block;
    margin-bottom: 4px;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
</style>
