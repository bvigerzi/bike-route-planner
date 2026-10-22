/** Apple platforms use ⌘ where others use Ctrl. iPadOS reports itself as a Mac. */
export const isApple = (platform = navigator.platform) => /Mac|iPhone|iPad|iPod/.test(platform);

/** The undo shortcut as the platform writes it, for tooltips. */
export const undoShortcutLabel = (platform = navigator.platform) => (isApple(platform) ? '⌘Z' : 'Ctrl+Z');

/** True for the platform's undo shortcut: ⌘Z on Apple platforms, Ctrl+Z elsewhere. Shift (redo) doesn't count. */
export function isUndoShortcut(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  platform = navigator.platform,
): boolean {
  const mod = isApple(platform) ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z';
}

/** True when the key press belongs to a text field, which has its own undo. */
export function inTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'));
}
