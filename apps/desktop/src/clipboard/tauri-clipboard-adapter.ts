import { clear, readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { ClipboardAdapter } from './clipboard-adapter';

/**
 * Tauri implementation -- a real OS clipboard command, not the
 * focus-restricted `navigator.clipboard` the Web adapter has to work
 * around. Requires `tauri-plugin-clipboard-manager` registered on the
 * Rust side (src-tauri/src/lib.rs) and its permissions granted
 * (src-tauri/capabilities/default.json) -- both already done
 * alongside this file.
 *
 * NOT verified in this sandbox -- same discipline as this codebase's
 * other not-yet-machine-verified integrations (see engine/opaque-
 * client.ts's header comment): `@tauri-apps/plugin-clipboard-manager`
 * needs the real Tauri runtime to actually invoke anything. Confirmed
 * against the real npm package's own `dist-js/index.d.ts` (function
 * signatures, not guessed), but must be run and confirmed on a real
 * machine before being trusted.
 */
export class TauriClipboardAdapter implements ClipboardAdapter {
  async writeText(text: string): Promise<void> {
    await writeText(text);
  }

  async readText(): Promise<string | null> {
    try {
      return await readText();
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await clear();
  }
}
