<script lang="ts">
  import { MOBILE_QUERY } from './lib/config';
  import MapView from './lib/MapView.svelte';
  import { decodeRoute, encodeRoute } from './lib/routeUrl';
  import Sidebar from './lib/Sidebar.svelte';
  import { planner } from './lib/state.svelte';

  // The route is mirrored into the URL hash, replacing the current history entry, so reloading,
  // going Back/Forward to the page or opening a shared link restores it.
  // On mobile the planner sits under the map; folding it leaves the map the whole screen.
  let plannerOpen = $state(!matchMedia(MOBILE_QUERY).matches);

  const initial = decodeRoute(location.hash);
  if (initial) planner.load(initial);

  // Debounced: Safari throws if history is replaced more than ~100 times in 10 s (e.g. typing a name).
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function writeUrl() {
    clearTimeout(timer);
    if (pending === null) return;
    const hash = pending;
    pending = null;
    if (hash === location.hash.slice(1)) return;
    try {
      history.replaceState(history.state, '', hash ? `#${hash}` : location.pathname + location.search);
    } catch {
      // Throttled or unavailable; the next change will try again.
    }
  }

  $effect(() => {
    pending = encodeRoute(planner.toState());
    clearTimeout(timer);
    timer = setTimeout(writeUrl, 250);
  });

  // Only fires for hash changes made outside the app (a pasted or edited URL); replaceState doesn't trigger it.
  function onHashChange() {
    clearTimeout(timer);
    pending = null;
    const state = decodeRoute(location.hash);
    if (state) planner.load(state);
    else planner.clear();
  }
</script>

<svelte:window onhashchange={onHashChange} onpagehide={writeUrl} />

<main class:folded={!plannerOpen}>
  <Sidebar bind:open={plannerOpen} />
  <MapView />
</main>

<style>
  main {
    display: grid;
    grid-template-columns: 340px 1fr;
    height: 100dvh;
  }
  @media (max-width: 700px) {
    main {
      grid-template-columns: 1fr;
      grid-template-rows: 60dvh auto;
      height: auto;
    }
    main > :global(aside) {
      order: 2;
    }
    /* Folded, only the planner's header shows below a map that fills the rest of the screen. */
    main.folded {
      grid-template-rows: 1fr auto;
      height: 100dvh;
    }
  }
</style>
