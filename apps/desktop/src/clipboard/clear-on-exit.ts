/**
 * Installs a Tauri window-close hook that flushes any pending
 * clipboard auto-clear immediately, instead of leaving a copied
 * credential sitting in the OS clipboard for up to
 * `CLIPBOARD_AUTO_CLEAR_TIMEOUT_MS` after the app itself has already
 * closed (raised by André, 2026-09-16: closing the app before the
 * 20s window elapses left the credential exposed with nothing
 * running anymore to clear it). Cuts the real exposure window for the
 * normal-close case -- the titlebar's X, Alt+F4, Cmd+Q -- from "up to
 * 20s after the window looks closed" down to "cleared before the app
 * is allowed to close at all".
 *
 * Deliberate limit, stated plainly rather than glossed over: this
 * covers only a graceful window-close request. A force-kill (Task
 * Manager / `kill -9`), a crash, or a power loss cannot run ANY
 * userspace cleanup code -- not in this app, not in any other
 * clipboard-based password manager. There is no mechanism, here or
 * anywhere, that closes that gap.
 *
 * Keeping a background process alive past window close to "wait out"
 * the remaining delay was considered and rejected: it doesn't cover
 * the force-kill/crash case either (same floor above), while adding a
 * real cost -- a process that visibly outlives the window the user
 * just closed is exactly the kind of thing a security-conscious user
 * (or an auditor) flags as suspicious, on a password manager
 * especially. Flushing immediately on a real close request is
 * strictly better than that, for zero added risk.
 *
 * Web has no code path here at all -- there is no reliable way to run
 * async cleanup on tab close in a browser (`beforeunload` does not
 * wait for promises, by design), so this installs nothing there;
 * `isTauri()` gates the whole thing to the packaged app only, same
 * pattern as `clipboard-adapter.ts`'s `getClipboardAdapter()`.
 */
import { flushPendingClipboardClear } from './pending-clipboard-clear';

export async function installClipboardClearOnExit(): Promise<void> {
  const { isTauri } = await import('@tauri-apps/api/core');
  if (!isTauri()) return;

  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const appWindow = getCurrentWindow();

  await appWindow.onCloseRequested(async (event) => {
    // Always intercept, even when nothing is pending -- the check
    // itself is cheap (flushPendingClipboardClear no-ops instantly if
    // the registry is empty) and this keeps the close sequence
    // identical (prevent -> flush -> destroy) whether or not there's
    // anything to clear, rather than branching on state we'd have to
    // read twice.
    event.preventDefault();
    try {
      await flushPendingClipboardClear();
    } finally {
      await appWindow.destroy();
    }
  });
}
