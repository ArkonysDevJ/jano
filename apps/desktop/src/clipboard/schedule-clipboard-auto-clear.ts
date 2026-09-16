import { CLIPBOARD_AUTO_CLEAR_TIMEOUT_MS } from '../config';
import type { ClipboardAdapter } from './clipboard-adapter';
import { armPendingClipboardClear, disarmPendingClipboardClear } from './pending-clipboard-clear';

/**
 * The actual "copy-then-verify-before-clear" check, shared by both
 * the normal delayed path below and clear-on-exit.ts's immediate
 * flush on a real window-close request -- one rule, run from two
 * different triggers, never two copies of the same logic to keep in
 * sync.
 */
export async function verifyThenClearClipboard(adapter: ClipboardAdapter, copiedText: string): Promise<void> {
  const current = await adapter.readText();
  if (current === copiedText) {
    await adapter.clear();
  }
}

/**
 * Arms a delayed clipboard clear that only actually clears if the
 * clipboard still holds exactly what was just copied --
 * "copy-then-verify-before-clear" per the Fase 1 checklist
 * (DOCVIS-JANO-01's companion doc). If that can't be confirmed
 * (`readText()` returns null -- see each `ClipboardAdapter`'s own
 * caveat) or the clipboard now holds something else (the user copied
 * a different value in the meantime), this is a no-op: it never
 * clears content it didn't verify it put there itself.
 *
 * Also registers this same verify-then-clear as the "pending
 * clipboard clear" (pending-clipboard-clear.ts) for the whole delay
 * window -- so if the app is closed before this timer fires,
 * clear-on-exit.ts's window-close hook can run it immediately instead
 * of leaving the credential sitting in the OS clipboard for the rest
 * of the delay after the app has already closed. Disarmed the moment
 * this timer fires on its own, so a later close doesn't re-run a
 * stale entry.
 *
 * Returns the timer handle so a caller can cancel a pending clear
 * that's no longer relevant (e.g. the credential was re-copied, or
 * the vault was locked).
 */
export function scheduleClipboardAutoClear(
  adapter: ClipboardAdapter,
  copiedText: string,
  delayMs: number = CLIPBOARD_AUTO_CLEAR_TIMEOUT_MS,
): ReturnType<typeof setTimeout> {
  const run = () => verifyThenClearClipboard(adapter, copiedText);
  armPendingClipboardClear(run);
  return setTimeout(() => {
    disarmPendingClipboardClear();
    void run();
  }, delayMs);
}
