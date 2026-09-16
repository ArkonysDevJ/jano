/**
 * Fase 1 checklist item 2 (DOCVIS-JANO-01's companion doc) -- unlock
 * screen. Fase 2's palette/typography tokens (theme.css) are applied
 * here via className/data-attribute only -- every flow, string, and
 * state transition below is unchanged from Fase 1's verified behavior.
 *
 * Two real flows, not a mock of either:
 * - No local vault yet (`VaultAccountStore.load()` returns null) ->
 *   the creation ceremony (`EngineClient.createNewVault`), then the
 *   recovery kit is shown ONCE (section 3 -- never persisted anywhere)
 *   before handing off.
 * - A local vault already exists -> ask for the master password
 *   (`EngineClient.unlockWithPassword`).
 *
 * Feedback while the worker is busy (Argon2id + AES-GCM, see
 * engine/kek.ts) is ONE stable message ("Unlocking vault...") in both
 * flows -- DOCVIS-JANO-01's non-negotiable: no granular phase detail
 * surfaces here (that belongs only in an optional, local-only
 * telemetry log this phase doesn't build). That busy state IS a real
 * active cryptographic event (KEK derivation), so its submit button
 * carries `data-crypto-active="true"` while `busy` is true -- the
 * ONLY accent usage in this component, per Fase 2's strict rule that
 * the phosphor accent is never decorative.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { EngineClient } from '../worker';
import { IndexedDbVaultAccountStore } from '../engine/indexeddb-vault-account-store';
import type { VaultAccountRecord, VaultAccountStore } from '../engine/vault-account-store';
import { bytesToBase64 } from './bytes-to-base64';

export interface UnlockScreenProps {
  /** The worker behind `client` already has the DEK resident when this fires. */
  readonly onUnlocked: (client: EngineClient) => void;
  /** Injection point for tests -- defaults to the real IndexedDB-backed store. */
  readonly store?: VaultAccountStore;
}

type Screen =
  | { readonly kind: 'checking' }
  | { readonly kind: 'create' }
  | { readonly kind: 'unlock'; readonly record: VaultAccountRecord }
  | { readonly kind: 'recovery-kit'; readonly client: EngineClient; readonly recoveryKitBase64: string };

export function UnlockScreen({ onUnlocked, store }: UnlockScreenProps) {
  const [accountStore] = useState<VaultAccountStore>(() => store ?? new IndexedDbVaultAccountStore());
  const [screen, setScreen] = useState<Screen>({ kind: 'checking' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKitSaved, setRecoveryKitSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    accountStore.load().then(
      (record) => {
        if (cancelled) return;
        setScreen(record ? { kind: 'unlock', record } : { kind: 'create' });
      },
      (loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        // Local record unreadable -- "no vault yet" is the safer fallback
        // than "unlock", which would need a record this branch couldn't get.
        setScreen({ kind: 'create' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [accountStore]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length === 0) {
      setError('Enter a master password.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    const client = new EngineClient();
    try {
      const vault = await client.createNewVault(password);
      await accountStore.save({ localSalt: vault.localSalt, wrappedMasterDek: vault.wrappedMasterDek });
      setScreen({ kind: 'recovery-kit', client, recoveryKitBase64: bytesToBase64(vault.recoveryKitSecret) });
    } catch (createError) {
      client.terminate();
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setBusy(false);
      setPassword('');
      setConfirmPassword('');
    }
  }

  async function handleUnlock(event: FormEvent<HTMLFormElement>, record: VaultAccountRecord) {
    event.preventDefault();
    setError(null);
    if (password.length === 0) {
      setError('Enter your master password.');
      return;
    }

    setBusy(true);
    const client = new EngineClient();
    try {
      await client.unlockWithPassword(password, record.localSalt, record.wrappedMasterDek);
      onUnlocked(client);
    } catch {
      // Never echo the underlying crypto error (AES-GCM auth-tag
      // mismatch detail) to the UI -- it isn't user-facing information.
      client.terminate();
      setError('Incorrect master password.');
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  if (screen.kind === 'checking') {
    return (
      <main className="jano-shell">
        <p className="jano-text">Checking for an existing vault...</p>
      </main>
    );
  }

  if (screen.kind === 'recovery-kit') {
    return (
      <main className="jano-shell">
        <h1 className="jano-heading">Save your recovery kit</h1>
        <p className="jano-text">
          This is the ONLY time this recovery key will be shown. Write it down
          and store it somewhere safe -- it is the only way to recover your
          vault if you forget your master password.
        </p>
        <p>
          <code className="jano-mono">{screen.recoveryKitBase64}</code>
        </p>
        <button
          type="button"
          className="jano-button"
          onClick={() => {
            navigator.clipboard?.writeText(screen.recoveryKitBase64).catch(() => {
              // Clipboard access can fail (permissions, insecure context) --
              // the key is still visible above to copy by hand either way.
            });
          }}
        >
          Copy to clipboard
        </button>
        <p className="jano-field">
          <label className="jano-text">
            <input
              type="checkbox"
              checked={recoveryKitSaved}
              onChange={(event) => setRecoveryKitSaved(event.target.checked)}
            />
            {' '}I have saved this recovery key somewhere safe.
          </label>
        </p>
        <button type="button" className="jano-button" disabled={!recoveryKitSaved} onClick={() => onUnlocked(screen.client)}>
          Continue
        </button>
      </main>
    );
  }

  if (screen.kind === 'create') {
    return (
      <main className="jano-shell">
        <h1 className="jano-heading">Create your vault</h1>
        <form onSubmit={handleCreate}>
          <div className="jano-field">
            <label className="jano-label" htmlFor="new-master-password">Master password</label>
            <input
              id="new-master-password"
              className="jano-input"
              type="password"
              value={password}
              autoComplete="new-password"
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="jano-field">
            <label className="jano-label" htmlFor="confirm-master-password">Confirm master password</label>
            <input
              id="confirm-master-password"
              className="jano-input"
              type="password"
              value={confirmPassword}
              autoComplete="new-password"
              disabled={busy}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
          {error && <p role="alert" className="jano-error">{error}</p>}
          <button type="submit" className="jano-button" disabled={busy} data-crypto-active={busy}>
            {busy ? 'Unlocking vault...' : 'Create vault'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="jano-shell">
      <h1 className="jano-heading">Unlock your vault</h1>
      <form onSubmit={(event) => handleUnlock(event, screen.record)}>
        <div className="jano-field">
          <label className="jano-label" htmlFor="master-password">Master password</label>
          <input
            id="master-password"
            className="jano-input"
            type="password"
            value={password}
            autoComplete="current-password"
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error && <p role="alert" className="jano-error">{error}</p>}
        <button type="submit" className="jano-button" disabled={busy} data-crypto-active={busy}>
          {busy ? 'Unlocking vault...' : 'Unlock'}
        </button>
      </form>
    </main>
  );
}
