<script lang="ts">
  import MapView from './lib/MapView.svelte';
  import Sidebar from './lib/Sidebar.svelte';
</script>

<main>
  <Sidebar />
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
  }
</style>
