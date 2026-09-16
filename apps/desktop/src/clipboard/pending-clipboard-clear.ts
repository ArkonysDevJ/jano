/**
 * A tiny module-level registry so an app-level shutdown hook
 * (clear-on-exit.ts, installed once from main.tsx) can find and run
 * whatever clipboard auto-clear is currently armed -- WITHOUT
 * CredentialRevealView needing to know anything about app lifecycle,
 * and without a global store/context just for this one signal.
 *
 * At most one credential is ever revealed at a time in this app's
 * current UI (a single CredentialRevealView instance, App.tsx), so a
 * single slot matches CredentialRevealView's own single `clearTimer`
 * ref -- a second `arm()` call simply replaces whatever was pending,
 * same as re-copying a credential replaces the earlier auto-clear.
 *
 * Deliberately NOT disarmed when CredentialRevealView unmounts (e.g.
 * the vault is locked while a credential is still sitting in the
 * clipboard, not yet auto-cleared): the whole point of this registry
 * is that closing the app should still flush that pending clear, even
 * after the component that armed it is long gone. It's only disarmed
 * when the arming timer itself actually fires (see
 * schedule-clipboard-auto-clear.ts), or when this flush runs.
 */

let pendingFlush: (() => Promise<void>) | null = null;

/** Registers (replacing any previous one) the flush to run if the app closes before its own timer fires. */
export function armPendingClipboardClear(flush: () => Promise<void>): void {
  pendingFlush = flush;
}

/** Call when the armed flush ran on its own (its normal timeout fired) -- avoids re-running a stale entry later. */
export function disarmPendingClipboardClear(): void {
  pendingFlush = null;
}

/** Runs and clears whatever is currently armed. No-op if nothing is pending. */
export async function flushPendingClipboardClear(): Promise<void> {
  const flush = pendingFlush;
  if (flush === null) return;
  pendingFlush = null;
  await flush();
}
