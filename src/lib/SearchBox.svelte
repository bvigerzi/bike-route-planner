<script lang="ts">
  import { searchPlaces, type Place } from './geocode';
  import { planner } from './state.svelte';

  let query = $state('');
  let results = $state<Place[]>([]);
  let status = $state('');

  async function search(e: SubmitEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    status = 'Searching…';
    try {
      results = await searchPlaces(query.trim(), planner.view);
      status = results.length ? '' : 'No results';
    } catch (err) {
      results = [];
      status = (err as Error).message;
    }
  }

  function pick(place: Place, asStart: boolean) {
    const label = place.label.split(',').slice(0, 2).join(',');
    if (asStart) planner.setStart(place.lat, place.lng, label);
    else planner.addWaypoint(place.lat, place.lng, label);
    planner.focus = [[place.lat, place.lng]];
    results = [];
    query = '';
  }
</script>

<form onsubmit={search}>
  <input type="search" placeholder="Search a place or address…" bind:value={query} />
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
