/**
 * Vault sync status indicator -- the functional piece the Fase 2
 * checklist's section 3 assumed already existed from Fase 1 (it
 * didn't; see the Fase 1 closeout audit). Fase 2's palette/typography
 * tokens (theme.css) are applied here via className only -- the
 * computation logic below is unchanged from when this component was
 * built as a Fase-2 prerequisite.
 *
 * Computes exactly one of the three DOCVIS-JANO-01 text states from
 * real signals -- never a placeholder or invented fourth state:
 *
 * - `PENDING SYNC: N ATOMIC ROTATION` -- a `PendingRotationStore`
 *   record exists (see rotation-state-machine.ts). N is always 1 here,
 *   not because it's hardcoded arbitrarily but because the store this
 *   app actually has is a single-slot design by construction
 *   (indexeddb-pending-rotation-store.ts's own header comment: "one
 *   small blob, one key" -- section 13's state machine only ever
 *   tracks ONE outstanding rotation per device at a time). If that
 *   store ever becomes multi-slot, this becomes the one place that
 *   needs to change to read a real count instead of presence.
 * - `NODE: AUTONOMOUS (LOCAL DEK ACTIVE)` -- no pending rotation, and
 *   the browser/webview reports itself offline (`navigator.onLine`).
 * - `NODE: SYNCHRONIZED` -- no pending rotation, and online.
 *
 * Deliberately NOT decrypting the pending-rotation payload to inspect
 * it: that payload is sealed under the NEW KEK (beginOfflineRotation's
 * own doc comment), which this indicator has no business holding --
 * presence of a record is itself the whole signal this state needs.
 *
 * Deliberately carries NO phosphor accent, ever, regardless of state
 * -- this is a status readout, not an active cryptographic event, and
 * Fase 2's checklist is strict that the accent is never decorative or
 * informational, only live-event. It's also plain `--font-sans`, not
 * monospace: these three strings are UI-synthesized status text, not
 * data crossing the engine's `Uint8Array` contract (unlike, say, a
 * revealed credential or the recovery kit's base64).
 *
 * Re-checks on `online`/`offline` window events (connectivity can
 * change without a remount) and once eagerly on mount. Rotation
 * pending-state is re-read on mount only -- the caller that clears it
 * (`completeOfflineRotation`) is expected to trigger a remount or a
 * `refreshToken` bump, not this component's job to poll.
 */
import { useEffect, useState } from 'react';
import { IndexedDbPendingRotationStore } from '../engine/indexeddb-pending-rotation-store';
import type { PendingRotationStore } from '../engine/rotation-state-machine';

export type VaultStatus =
  | { readonly kind: 'synchronized' }
  | { readonly kind: 'autonomous' }
  | { readonly kind: 'pending-sync'; readonly rotationCount: number };

export function vaultStatusText(status: VaultStatus): string {
  switch (status.kind) {
    case 'synchronized':
      return 'NODE: SYNCHRONIZED';
    case 'autonomous':
      return 'NODE: AUTONOMOUS (LOCAL DEK ACTIVE)';
    case 'pending-sync':
      return `PENDING SYNC: ${status.rotationCount} ATOMIC ROTATION`;
  }
}

export interface VaultStatusIndicatorProps {
  /** Injection point for tests -- defaults to the real IndexedDB-backed store. */
  readonly store?: PendingRotationStore;
  /** Injection point for tests -- defaults to `navigator.onLine`. */
  readonly isOnline?: () => boolean;
}

export function VaultStatusIndicator({ store, isOnline }: VaultStatusIndicatorProps) {
  const [rotationStore] = useState<PendingRotationStore>(() => store ?? new IndexedDbPendingRotationStore());
  const readOnline = isOnline ?? (() => navigator.onLine);
  const [status, setStatus] = useState<VaultStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    function recomputeConnectivityOnly() {
      setStatus((current) => {
        if (current?.kind === 'pending-sync') return current; // rotation presence wins regardless of connectivity
        return readOnline() ? { kind: 'synchronized' } : { kind: 'autonomous' };
      });
    }

    rotationStore.load().then((packed) => {
      if (cancelled) return;
      if (packed) {
        setStatus({ kind: 'pending-sync', rotationCount: 1 });
      } else {
        setStatus(readOnline() ? { kind: 'synchronized' } : { kind: 'autonomous' });
      }
    });

    window.addEventListener('online', recomputeConnectivityOnly);
    window.addEventListener('offline', recomputeConnectivityOnly);
    return () => {
      cancelled = true;
      window.removeEventListener('online', recomputeConnectivityOnly);
      window.removeEventListener('offline', recomputeConnectivityOnly);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rotationStore/readOnline are stable for the component's lifetime (rotationStore via useState initializer, readOnline via the prop/default pattern used throughout this codebase, e.g. UnlockScreen's accountStore).
  }, []);

  if (status === null) {
    return null; // one tick of "checking" -- no flash of a wrong state, same principle as UnlockScreen's 'checking' screen
  }

  return (
    <p role="status" className="jano-status">
      {vaultStatusText(status)}
    </p>
  );
}
