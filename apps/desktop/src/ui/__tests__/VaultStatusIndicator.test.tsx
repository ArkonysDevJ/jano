// @vitest-environment jsdom
/**
 * VaultStatusIndicator's own logic (which of the three DOCVIS-JANO-01
 * states it picks, and how it reacts to connectivity changes) --
 * both the rotation store and `navigator.onLine` are simple
 * injectable fakes here (VaultStatusIndicatorProps.store/isOnline),
 * mirroring UnlockScreen.test.tsx's InMemoryVaultAccountStore pattern.
 * The real IndexedDbPendingRotationStore already has its own dedicated
 * test file (engine/__tests__/indexeddb-pending-rotation-store.test.ts)
 * and isn't re-proven here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { VaultStatusIndicator } from '../VaultStatusIndicator';
import type { PendingRotationStore } from '../../engine/rotation-state-machine';
import type { Bytes } from '../../engine/types';

class InMemoryPendingRotationStore implements PendingRotationStore {
  #packed: Bytes | null;

  constructor(initial: Bytes | null = null) {
    this.#packed = initial;
  }

  async save(packed: Bytes): Promise<void> {
    this.#packed = packed;
  }

  async load(): Promise<Bytes | null> {
    return this.#packed;
  }

  async clear(): Promise<void> {
    this.#packed = null;
  }
}

describe('VaultStatusIndicator', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows NODE: SYNCHRONIZED when there is no pending rotation and the device is online', async () => {
    render(<VaultStatusIndicator store={new InMemoryPendingRotationStore()} isOnline={() => true} />);
    await screen.findByText('NODE: SYNCHRONIZED');
  });

  it('shows NODE: AUTONOMOUS (LOCAL DEK ACTIVE) when there is no pending rotation and the device is offline', async () => {
    render(<VaultStatusIndicator store={new InMemoryPendingRotationStore()} isOnline={() => false} />);
    await screen.findByText('NODE: AUTONOMOUS (LOCAL DEK ACTIVE)');
  });

  it('shows PENDING SYNC: 1 ATOMIC ROTATION when a pending rotation record exists, regardless of connectivity', async () => {
    const store = new InMemoryPendingRotationStore(new Uint8Array([1, 2, 3]));
    render(<VaultStatusIndicator store={store} isOnline={() => true} />);
    await screen.findByText('PENDING SYNC: 1 ATOMIC ROTATION');
  });

  it('reacts live to online/offline events once mounted synchronized', async () => {
    // The `isOnline` fake has to actually reflect the connectivity
    // being simulated -- a fixed `() => true` stub would return the
    // same answer no matter which window event fires, which is a bug
    // in the TEST (not the component): it can never observe the
    // component reacting to `offline` at all. `online` mirrors a
    // mutable variable the test flips right before each dispatch, the
    // same way a real `navigator.onLine` read would reflect the
    // browser's actual state at call time.
    let online = true;
    render(<VaultStatusIndicator store={new InMemoryPendingRotationStore()} isOnline={() => online} />);
    await screen.findByText('NODE: SYNCHRONIZED');

    act(() => {
      online = false;
      window.dispatchEvent(new Event('offline'));
    });
    await screen.findByText('NODE: AUTONOMOUS (LOCAL DEK ACTIVE)');

    act(() => {
      online = true;
      window.dispatchEvent(new Event('online'));
    });
    await screen.findByText('NODE: SYNCHRONIZED');
  });

  it('keeps showing PENDING SYNC on a connectivity event when a rotation is pending', async () => {
    const store = new InMemoryPendingRotationStore(new Uint8Array([1]));
    render(<VaultStatusIndicator store={store} isOnline={() => false} />);
    await screen.findByText('PENDING SYNC: 1 ATOMIC ROTATION');

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    // Still pending -- online/offline events must not clobber a real pending-rotation signal.
    await screen.findByText('PENDING SYNC: 1 ATOMIC ROTATION');
  });
});
