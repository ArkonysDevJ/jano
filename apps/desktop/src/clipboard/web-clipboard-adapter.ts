import type { ClipboardAdapter } from './clipboard-adapter';

/**
 * Plain-browser implementation -- what the Web target (the future
 * install-free demo) has available. See clipboard-adapter.ts's header
 * comment for the focus-restriction caveat this class works around by
 * returning null instead of throwing.
 */
export class WebClipboardAdapter implements ClipboardAdapter {
  async writeText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }

  async readText(): Promise<string | null> {
    try {
      return await navigator.clipboard.readText();
    } catch {
      // Most commonly: the document doesn't have focus right now
      // (ARCHITECTURE-01.md section 10). Not a real error from this
      // class's point of view -- the caller (schedule-clipboard-
      // auto-clear.ts) treats null as "can't verify, so don't clear".
      return null;
    }
  }

  async clear(): Promise<void> {
    // No real "clear the clipboard" primitive on the Web platform --
    // overwriting with an empty string is the closest equivalent.
    await navigator.clipboard.writeText('');
  }
}
