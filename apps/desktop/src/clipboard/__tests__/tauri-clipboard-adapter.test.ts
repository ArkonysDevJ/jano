/**
 * `@tauri-apps/plugin-clipboard-manager` talks over Tauri's IPC to a
 * real OS clipboard command, which doesn't exist in Vitest --
 * necessarily mocked here, same as this codebase's other tests that
 * can't reach a real external system directly (e.g.
 * rotation-http-client.test.ts fakes the network, not real OPAQUE
 * math). This only proves TauriClipboardAdapter's OWN logic (the
 * pass-through, and readText()'s null-instead-of-throw) is correct
 * against the plugin's documented call shape -- not that the plugin
 * itself works, which needs a real Tauri build (see this file's
 * sibling module's own header comment).
 */
import { describe, expect, it, vi } from 'vitest';

const writeText = vi.fn().mockResolvedValue(undefined);
const readText = vi.fn();
const clear = vi.fn().mockResolvedValue(undefined);

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText, readText, clear }));

describe('TauriClipboardAdapter', () => {
  it('writeText() delegates to the plugin', async () => {
    const { TauriClipboardAdapter } = await import('../tauri-clipboard-adapter');
    await new TauriClipboardAdapter().writeText('a real secret');
    expect(writeText).toHaveBeenCalledWith('a real secret');
  });

  it('readText() returns the plugin value when it resolves', async () => {
    readText.mockResolvedValueOnce('a real secret');
    const { TauriClipboardAdapter } = await import('../tauri-clipboard-adapter');
    expect(await new TauriClipboardAdapter().readText()).toBe('a real secret');
  });

  it('readText() returns null (never throws) if the plugin call fails', async () => {
    readText.mockRejectedValueOnce(new Error('clipboard permission denied'));
    const { TauriClipboardAdapter } = await import('../tauri-clipboard-adapter');
    expect(await new TauriClipboardAdapter().readText()).toBeNull();
  });

  it('clear() delegates to the plugin’s real clear command', async () => {
    const { TauriClipboardAdapter } = await import('../tauri-clipboard-adapter');
    await new TauriClipboardAdapter().clear();
    expect(clear).toHaveBeenCalled();
  });
});
