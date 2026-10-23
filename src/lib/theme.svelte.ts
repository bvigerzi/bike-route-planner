// Light by default, whatever the system prefers; the planner's toggle switches to dark and is remembered.
// index.html applies the saved choice before the app loads, so a dark page doesn't flash light first.
import { tick } from 'svelte';

const KEY = 'brp.theme';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === 'dark';
  } catch {
    return false;
  }
}

export const theme = $state({ dark: load() });

// The map swaps to its light or dark style when the theme changes, and sets this to a promise that resolves
// once the new style has drawn, so the cross-fade below ends on it rather than on a half-loaded map.
export const themeSync: { mapReady?: () => Promise<void> } = {};
// Longer than this and the fade goes ahead without waiting for the map.
const MAP_WAIT_MS = 1500;

function apply() {
  theme.dark = !theme.dark;
  document.documentElement.dataset.theme = theme.dark ? 'dark' : 'light';
  try {
    localStorage.setItem(KEY, theme.dark ? 'dark' : 'light');
  } catch {
    // Storage unavailable; the choice lasts until reload.
  }
}

// Cross-fades the whole page (map tiles included) between themes where the browser supports view transitions.
export function toggleDark() {
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(async () => {
      apply();
      await tick();
      await Promise.race([themeSync.mapReady?.(), new Promise((r) => setTimeout(r, MAP_WAIT_MS))]);
    });
  } else {
    apply();
  }
}
