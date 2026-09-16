/**
 * Client-side configuration constants -- named, exported, and
 * deliberately gathered in one place instead of inlined at each call
 * site, so a future "let the user tune these" setting (not built yet)
 * has a single spot to read from and write back to.
 *
 * Both values below are explicit product decisions (not defaults
 * picked by this codebase), for Fase 1 checklist item 3
 * (DOCVIS-JANO-01's companion doc) -- the single-credential
 * reveal/copy view.
 */

/**
 * How long a revealed credential stays visible (and in the DOM --
 * see CredentialRevealView.tsx) while the view keeps focus, before it
 * re-masks and the plaintext node is destroyed on its own. Losing
 * focus (on-blur) destroys it immediately regardless of this timeout;
 * 10s is enough to read/note it down in that case, and keeps the
 * window where the DOM actually holds the plaintext short.
 */
export const UI_AUTO_MASK_TIMEOUT_MS = 10_000;

/**
 * How long after a copy the clipboard is cleared automatically
 * (verified first -- only cleared if it still holds exactly what was
 * copied, see clipboard/schedule-clipboard-auto-clear.ts). 20s leaves
 * ergonomic room for an Alt+Tab into the field the credential is
 * being pasted into, while cutting the exposure window by a third
 * against the common 30s convention.
 */
export const CLIPBOARD_AUTO_CLEAR_TIMEOUT_MS = 20_000;
