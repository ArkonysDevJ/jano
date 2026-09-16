/**
 * `clear-on-exit.ts` only ever talks to the real Tauri window API
 * through the two dynamic `import()`s it does itself (mirroring
 * `clipboard-adapter.ts`'s own `getClipboardAdapter()` pattern) --
 * there is no real Tauri runtime in Vitest, so both
 * `@tauri-apps/api/core` and `@tauri-apps/api/window` are mocked
 * here. `vi.mock` intercepts dynamic imports the same way it does
 * static ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isTauriMock = vi.fn();
const onCloseRequestedMock = vi.fn();
const destroyMock = vi.fn().mockResolvedValue(undefined);
const getCurrentWindowMock = vi.fn(() => ({
  onCloseRequested: onCloseRequestedMock,
  destroy: destroyMock,
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: isTauriMock }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: getCurrentWindowMock }));

describe('installClipboardClearOnExit', () => {
  beforeEach(() => {
    isTauriMock.mockReset();
    onCloseRequestedMock.mockReset();
    destroyMock.mockClear();
    getCurrentWindowMock.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('installs nothing on Web -- isTauri() false', async () => {
    isTauriMock.mockReturnValue(false);
    const { installClipboardClearOnExit } = await import('../clear-on-exit');

    await installClipboardClearOnExit();

    expect(getCurrentWindowMock).not.toHaveBeenCalled();
    expect(onCloseRequestedMock).not.toHaveBeenCalled();
  });

  it('on a real close request, flushes the pending clipboard clear before destroying the window', async () => {
    isTauriMock.mockReturnValue(true);
    const { installClipboardClearOnExit } = await import('../clear-on-exit');
    const { armPendingClipboardClear } = await import('../pending-clipboard-clear');

    const flush = vi.fn().mockResolvedValue(undefined);
    armPendingClipboardClear(flush);

    await installClipboardClearOnExit();
    expect(onCloseRequestedMock).toHaveBeenCalledTimes(1);

    const closeHandler = onCloseRequestedMock.mock.calls[0][0] as (event: {
      preventDefault: () => void;
    }) => Promise<void>;
    const preventDefault = vi.fn();

    await closeHandler({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(destroyMock).toHaveBeenCalledTimes(1);
    // destroy() must happen AFTER the flush resolves, not concurrently with it.
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(destroyMock.mock.invocationCallOrder[0]);
  });

  it('still destroys the window even if nothing was pending to flush', async () => {
    isTauriMock.mockReturnValue(true);
    const { installClipboardClearOnExit } = await import('../clear-on-exit');

    await installClipboardClearOnExit();
    const closeHandler = onCloseRequestedMock.mock.calls[0][0] as (event: {
      preventDefault: () => void;
    }) => Promise<void>;

    await closeHandler({ preventDefault: vi.fn() });

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});
