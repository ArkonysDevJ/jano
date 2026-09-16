/**
 * Web-vs-Tauri clipboard distinction, ARCHITECTURE-01.md section 10:
 * `navigator.clipboard.readText()` on Web requires document focus and
 * throws otherwise, which is exactly the problem a Tauri native
 * command doesn't have. Both implementations (web-clipboard-adapter.ts,
 * tauri-clipboard-adapter.ts) share this one interface so
 * CredentialRevealView.tsx never branches on platform itself -- see
 * `getClipboardAdapter()` below for where that branch actually lives.
 */

export interface ClipboardAdapter {
  writeText(text: string): Promise<void>;
  /** Returns null instead of throwing when the clipboard can't be read right now -- see the Web caveat above. */
  readText(): Promise<string | null>;
  /** Best-effort clear -- see each implementation for what "clear" actually means on that target. */
  clear(): Promise<void>;
}

let cachedAdapter: ClipboardAdapter | undefined;

/**
 * Picks the real implementation for whatever this code is running in
 * right now, via `@tauri-apps/api/core`'s own `isTauri()` -- not a
 * build-time flag, so the exact same bundle works in a plain browser
 * tab (the future web demo) and inside a Tauri webview.
 *
 * Dynamic `import()` on purpose, not a static top-level import: it
 * means the Web bundle never even loads
 * `@tauri-apps/plugin-clipboard-manager`'s JS (dead weight there,
 * since it only talks to a Tauri IPC command that doesn't exist on
 * Web) and the Tauri build never loads the Web fallback's code either
 * -- Vite gives each its own chunk, loaded only on the side that
 * actually needs it. Cached after the first call since the answer
 * never changes within one running app.
 */
export async function getClipboardAdapter(): Promise<ClipboardAdapter> {
  if (!cachedAdapter) {
    const { isTauri } = await import('@tauri-apps/api/core');
    if (isTauri()) {
      const { TauriClipboardAdapter } = await import('./tauri-clipboard-adapter');
      cachedAdapter = new TauriClipboardAdapter();
    } else {
      const { WebClipboardAdapter } = await import('./web-clipboard-adapter');
      cachedAdapter = new WebClipboardAdapter();
    }
  }
  return cachedAdapter;
}
