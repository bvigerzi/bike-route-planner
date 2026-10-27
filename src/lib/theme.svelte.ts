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

function apply() {
  theme.dark = !theme.dark;
  document.documentElement.dataset.theme = theme.dark ? 'dark' : 'light';
  try {
    localStorage.setItem(KEY, theme.dark ? 'dark' : 'light');
  } catch {
    // Storage unavailable; the choice lasts until reload.
  }
}

// Cross-fades the whole page between themes where the browser supports view transitions. The fade starts at once
// and never waits for the map: the page stays frozen until the callback resolves, which read as a missed click.
export function toggleDark() {
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(async () => {
      apply();
      await tick();
    });
  } else {
    apply();
  }
}
