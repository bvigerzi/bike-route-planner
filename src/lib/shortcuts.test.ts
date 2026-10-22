import { describe, expect, it } from 'vitest';
import { isUndoShortcut, undoShortcutLabel } from './shortcuts';

const key = (k: Partial<KeyboardEvent>) => ({ key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...k });

describe('isUndoShortcut', () => {
  it('uses ⌘Z on Apple platforms', () => {
    expect(isUndoShortcut(key({ metaKey: true }), 'MacIntel')).toBe(true);
    expect(isUndoShortcut(key({ metaKey: true }), 'iPhone')).toBe(true);
    expect(isUndoShortcut(key({ ctrlKey: true }), 'MacIntel')).toBe(false);
    expect(undoShortcutLabel('MacIntel')).toBe('⌘Z');
  });

  it('uses Ctrl+Z elsewhere', () => {
    expect(isUndoShortcut(key({ ctrlKey: true }), 'Win32')).toBe(true);
    expect(isUndoShortcut(key({ ctrlKey: true }), 'Linux x86_64')).toBe(true);
    expect(isUndoShortcut(key({ metaKey: true }), 'Win32')).toBe(false);
    expect(undoShortcutLabel('Win32')).toBe('Ctrl+Z');
  });

  it('ignores redo, other keys and caps lock', () => {
    expect(isUndoShortcut(key({ ctrlKey: true, shiftKey: true }), 'Win32')).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, key: 'y' }), 'Win32')).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, key: 'Z' }), 'Win32')).toBe(true);
    expect(isUndoShortcut(key({}), 'Win32')).toBe(false);
  });
});
