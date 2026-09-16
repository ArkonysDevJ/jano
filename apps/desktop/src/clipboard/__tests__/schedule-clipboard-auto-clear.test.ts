import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleClipboardAutoClear } from '../schedule-clipboard-auto-clear';
import { flushPendingClipboardClear } from '../pending-clipboard-clear';
import type { ClipboardAdapter } from '../clipboard-adapter';

function fakeAdapter(readTextResult: string | null): ClipboardAdapter {
  return {
    writeText: vi.fn(),
    readText: vi.fn().mockResolvedValue(readTextResult),
    clear: vi.fn().mockResolvedValue(undefined),
  };
}

describe('scheduleClipboardAutoClear', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears after the delay when the clipboard still holds exactly what was copied', async () => {
    const adapter = fakeAdapter('the real secret');
    scheduleClipboardAutoClear(adapter, 'the real secret', 1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(adapter.readText).toHaveBeenCalled();
    expect(adapter.clear).toHaveBeenCalled();
  });

  it('does NOT clear if the clipboard now holds something else -- never touches content it did not verify', async () => {
    const adapter = fakeAdapter('something the user copied afterward');
    scheduleClipboardAutoClear(adapter, 'the real secret', 1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(adapter.clear).not.toHaveBeenCalled();
  });

  it('does NOT clear if the clipboard cannot be verified (readText() returned null)', async () => {
    const adapter = fakeAdapter(null);
    scheduleClipboardAutoClear(adapter, 'the real secret', 1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(adapter.clear).not.toHaveBeenCalled();
  });

  it('does not fire before the delay has elapsed', async () => {
    const adapter = fakeAdapter('the real secret');
    scheduleClipboardAutoClear(adapter, 'the real secret', 1000);

    await vi.advanceTimersByTimeAsync(999);

    expect(adapter.readText).not.toHaveBeenCalled();
  });

  it('arms the pending-clipboard-clear registry immediately, so an app close before the delay can flush it early', async () => {
    const adapter = fakeAdapter('the real secret');
    scheduleClipboardAutoClear(adapter, 'the real secret', 1000);

    // Flushing well before the 1000ms delay still clears -- this is
    // exactly clear-on-exit.ts's real usage: a window-close request
    // arriving before the scheduled timer would have fired.
    await flushPendingClipboardClear();

    expect(adapter.clear).toHaveBeenCalledTimes(1);
  });

  it('disarms the registry once its own timer has fired, so a later flush does not run it again', async () => {
    const adapter = fakeAdapter('the real secret');
    scheduleClipboardAutoClear(adapter, 'the real secret', 1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.clear).toHaveBeenCalledTimes(1);

    await flushPendingClipboardClear();
    expect(adapter.clear).toHaveBeenCalledTimes(1); // still just once -- the registry had nothing left to run
  });
});
