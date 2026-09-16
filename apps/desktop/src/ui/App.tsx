/**
 * Root component. Fase 1 checklist (DOCVIS-JANO-01's companion doc):
 * item 2 (unlock screen, UnlockScreen.tsx) and item 3 (single-
 * credential reveal/copy view, CredentialRevealView.tsx) are both
 * real now. Fase 2's palette/typography tokens (theme.css, imported
 * once in main.tsx) are applied here via className only -- nothing in
 * this file's actual logic changed for Fase 2.
 *
 * There is still no real vault-item storage (WatermelonDB isn't built
 * -- see README.md's "Not implemented yet"), so this component
 * encrypts ONE demo item through the real, resident DEK right after
 * unlock, purely so CredentialRevealView has a real ciphertext to
 * decrypt against instead of a hand-wired mock. Nothing here persists
 * across a lock/unlock cycle -- that's exactly right for a
 * placeholder standing in for a storage layer that doesn't exist yet.
 */
import { useEffect, useState } from 'react';
import type { EngineClient } from '../worker';
import { deserializeVaultItem, serializeVaultItem } from '../engine/vault-item';
import { VAULT_ITEM_SCHEMA_VERSION } from '../engine/types';
import type { Bytes, VaultItemPlaintext } from '../engine/types';
import { UnlockScreen } from './UnlockScreen';
import { CredentialRevealView } from './CredentialRevealView';
import { VaultStatusIndicator } from './VaultStatusIndicator';

const DEMO_ITEM: VaultItemPlaintext = {
  schemaVersion: VAULT_ITEM_SCHEMA_VERSION,
  title: 'Fase 1 demo entry',
  username: 'demo@jano.local',
  password: 'CorrectHorseBatteryStaple-Demo',
};

export function App() {
  const [client, setClient] = useState<EngineClient | null>(null);
  const [demoCiphertext, setDemoCiphertext] = useState<Bytes | null>(null);

  useEffect(() => {
    if (!client) {
      setDemoCiphertext(null);
      return;
    }
    let cancelled = false;
    client.encryptItem(serializeVaultItem(DEMO_ITEM)).then((ciphertext) => {
      if (!cancelled) setDemoCiphertext(ciphertext);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (!client) {
    return <UnlockScreen onUnlocked={setClient} />;
  }

  async function handleLock() {
    await client!.lock();
    // Simplification for this phase: a full lock tears down the
    // worker outright rather than just clearing its resident DEK and
    // keeping it alive for a faster re-unlock. Re-deriving the KEK via
    // Argon2id is required either way on the next unlock (the master
    // password itself isn't cached anywhere), so this costs nothing
    // extra in practice while guaranteeing no residual worker state.
    client!.terminate();
    setClient(null);
  }

  return (
    <main className="jano-shell">
      <h1 className="jano-heading">Jano</h1>
      <VaultStatusIndicator />
      {demoCiphertext ? (
        <CredentialRevealView
          title={DEMO_ITEM.title}
          username={DEMO_ITEM.username}
          revealPassword={async () => {
            const plaintext = await client.decryptItem(demoCiphertext);
            return deserializeVaultItem(plaintext).password;
          }}
        />
      ) : (
        <p className="jano-text">Preparing demo credential...</p>
      )}
      <button type="button" className="jano-button" onClick={handleLock}>
        Lock
      </button>
    </main>
  );
}
