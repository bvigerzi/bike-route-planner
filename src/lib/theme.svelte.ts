// Light by default, whatever the system prefers; the planner's toggle switches to dark and is remembered.
// index.html applies the saved choice before the app loads, so a dark page doesn't flash light first.
const KEY = 'brp.theme';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === 'dark';
  } catch {
    return false;
  }
}

export const theme = $state({ dark: load() });

export function toggleDark() {
  theme.dark = !theme.dark;
  document.documentElement.dataset.theme = theme.dark ? 'dark' : 'light';
  try {
    localStorage.setItem(KEY, theme.dark ? 'dark' : 'light');
  } catch {
    // Storage unavailable; the choice lasts until reload.
  }
}
