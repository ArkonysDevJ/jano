import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  armPendingClipboardClear,
  disarmPendingClipboardClear,
  flushPendingClipboardClear,
} from '../pending-clipboard-clear';

describe('pending-clipboard-clear registry', () => {
  afterEach(() => {
    // The registry is module-level state -- leaving something armed
    // across tests would make a later test observe an earlier one's
    // flush. Clear it unconditionally after every test.
    disarmPendingClipboardClear();
  });

  it('is a no-op when nothing is armed', async () => {
    await expect(flushPendingClipboardClear()).resolves.toBeUndefined();
  });

  it('runs the armed flush exactly once, then clears the slot', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    armPendingClipboardClear(flush);

    await flushPendingClipboardClear();
    expect(flush).toHaveBeenCalledTimes(1);

    await flushPendingClipboardClear();
    expect(flush).toHaveBeenCalledTimes(1); // second flush is a no-op -- already consumed
  });

  it('a newer arm() replaces an older one -- only the latest ever runs', async () => {
    const older = vi.fn().mockResolvedValue(undefined);
    const newer = vi.fn().mockResolvedValue(undefined);
    armPendingClipboardClear(older);
    armPendingClipboardClear(newer);

    await flushPendingClipboardClear();

    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();
  });

  it('disarmPendingClipboardClear prevents a later flush from running anything', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    armPendingClipboardClear(flush);
    disarmPendingClipboardClear();

    await flushPendingClipboardClear();

    expect(flush).not.toHaveBeenCalled();
  });
});
