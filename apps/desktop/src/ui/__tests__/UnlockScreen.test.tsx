// @vitest-environment jsdom
/**
 * Component-level test against the REAL `EngineClient` (a real Worker,
 * via `@vitest/web-worker` -- see vitest.config.ts's `setupFiles`, and
 * `worker/__tests__/engine-client.test.ts` for that boundary's own
 * dedicated test) -- only the local persistence store is a simple
 * in-memory fake here (`UnlockScreenProps.store`'s injection point),
 * since exercising the real `IndexedDbVaultAccountStore` is already
 * covered by its own test file and isn't this test's concern.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { UnlockScreen } from '../UnlockScreen';
import type { EngineClient } from '../../worker';
import type { VaultAccountRecord, VaultAccountStore } from '../../engine/vault-account-store';

class InMemoryVaultAccountStore implements VaultAccountStore {
  #record: VaultAccountRecord | null = null;

  async save(record: VaultAccountRecord): Promise<void> {
    this.#record = record;
  }

  async load(): Promise<VaultAccountRecord | null> {
    return this.#record;
  }

  async clear(): Promise<void> {
    this.#record = null;
  }
}

describe('UnlockScreen', () => {
  // Explicit, not relying on @testing-library/react's auto-cleanup --
  // that only self-registers against a GLOBAL `afterEach`, and this
  // project keeps `test.globals: false` (vitest.config.ts) so every
  // spec file imports its own `describe`/`it`/`expect` explicitly.
  // Without this, each test's render stays mounted into the next
  // one's DOM within this same file, and duplicate-element lookups
  // (e.g. "Master password") start failing nondeterministically.
  afterEach(() => cleanup());

  it('creates a vault, shows the recovery kit once, then hands off a working client', async () => {
    const store = new InMemoryVaultAccountStore();
    let unlockedClient: EngineClient | null = null;
    render(<UnlockScreen store={store} onUnlocked={(client) => (unlockedClient = client)} />);

    await screen.findByRole('heading', { name: 'Create your vault' });

    fireEvent.change(screen.getByLabelText('Master password'), {
      target: { value: 'a real master password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm master password'), {
      target: { value: 'a real master password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create vault' }));

    await screen.findByRole('heading', { name: 'Save your recovery kit' });
    expect(await store.load()).not.toBeNull(); // persisted locally before showing the kit

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(unlockedClient).not.toBeNull());
    try {
      const plaintext = new TextEncoder().encode('proof the handed-off client actually works');
      const ciphertext = await unlockedClient!.encryptItem(plaintext);
      expect(await unlockedClient!.decryptItem(ciphertext)).toEqual(plaintext);
    } finally {
      unlockedClient!.terminate();
    }
  });

  it('rejects mismatched passwords before ever touching the engine', async () => {
    const store = new InMemoryVaultAccountStore();
    render(<UnlockScreen store={store} onUnlocked={() => {}} />);

    await screen.findByRole('heading', { name: 'Create your vault' });
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'password one' } });
    fireEvent.change(screen.getByLabelText('Confirm master password'), { target: { value: 'password two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create vault' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('do not match');
    expect(await store.load()).toBeNull(); // nothing was ever created
  });

  it('unlocks an existing local vault with the correct password, rejects the wrong one first', async () => {
    const store = new InMemoryVaultAccountStore();
    // Seed a real vault record the same way the create flow would.
    const { EngineClient } = await import('../../worker');
    const seeder = new EngineClient();
    const vault = await seeder.createNewVault('the real password');
    await store.save({ localSalt: vault.localSalt, wrappedMasterDek: vault.wrappedMasterDek });
    seeder.terminate();

    let unlockedClient: EngineClient | null = null;
    render(<UnlockScreen store={store} onUnlocked={(client) => (unlockedClient = client)} />);

    await screen.findByRole('heading', { name: 'Unlock your vault' });

    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'the wrong password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('Incorrect master password.');
    expect(unlockedClient).toBeNull();

    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'the real password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(unlockedClient).not.toBeNull());
    unlockedClient!.terminate();
  });
});
