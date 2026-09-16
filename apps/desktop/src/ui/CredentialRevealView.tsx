/**
 * Fase 1 checklist item 3 (DOCVIS-JANO-01's companion doc) --
 * single-credential reveal/copy view. Fase 2's palette/typography
 * tokens (theme.css) are applied here via className/data-attribute
 * only -- every state transition below is unchanged from Fase 1's
 * verified behavior.
 *
 * Masked by default. Revealing calls `revealPassword()` (the caller's
 * job to decrypt -- this component only ever holds a plaintext
 * password string it was explicitly handed, per types.ts's rule that
 * turning engine `Bytes` into a `string` is the UI layer's own
 * declared step, done by the caller composing that callback, not
 * here). The revealed node is destroyed from the DOM (not just
 * hidden) on blur, or after `UI_AUTO_MASK_TIMEOUT_MS` while it still
 * has focus -- see config.ts for both timeout values and why they're
 * what they are. That destruction is a plain conditional render
 * (`password === null ? ... : ...`), never animated -- theme.css
 * deliberately defines no `transition`/`animation` on `.jano-credential`
 * or its `<code>` child, and must never gain one (Fase 2 checklist
 * section 0: no delay to this on-blur destruction, ever).
 *
 * Copying arms a clipboard auto-clear via `scheduleClipboardAutoClear`
 * (clipboard/), which only clears if the clipboard still holds exactly
 * what was copied -- "copy-then-verify-before-clear" per the
 * checklist. The copy confirmation is never color alone
 * (DOCVIS-JANO-01's accessibility requirement): it's a text node
 * ("Copied to clipboard."), a `[COPIED]` glyph, AND a
 * `data-copy-confirmed` attribute the wrapping `<p>` carries, styled
 * in theme.css as a 1px->2px border-width step using the neutral
 * `--color-border-emphasis` token -- deliberately NOT the phosphor
 * accent, since copying is not itself a cryptographic event (only
 * `handleReveal`'s decrypt call is -- see its `data-crypto-active`
 * button below).
 */
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { UI_AUTO_MASK_TIMEOUT_MS } from '../config';
import { getClipboardAdapter, scheduleClipboardAutoClear } from '../clipboard';
import type { ClipboardAdapter } from '../clipboard';

export interface CredentialRevealViewProps {
  readonly title: string;
  readonly username: string;
  /** Decrypts and returns the plaintext password. Called fresh on every reveal -- never cached by this component. */
  readonly revealPassword: () => Promise<string>;
  /** Injection point for tests -- defaults to the real platform-detected adapter (clipboard/). */
  readonly clipboardAdapter?: ClipboardAdapter;
  /**
   * Injection point for tests -- defaults to `UI_AUTO_MASK_TIMEOUT_MS`.
   * A real 10s `setTimeout` doesn't mix reliably with Testing
   * Library's polling-based `findBy*`/`waitFor` under
   * `vi.useFakeTimers()` (this component's own test hit exactly that
   * -- see `__tests__/CredentialRevealView.test.tsx`'s header
   * comment); overriding this to a few milliseconds keeps that test
   * fast and honest, exercising the same code path with real timers
   * instead of fighting the fake-timer/polling interaction.
   */
  readonly autoMaskTimeoutMs?: number;
}

export function CredentialRevealView({
  title,
  username,
  revealPassword,
  clipboardAdapter,
  autoMaskTimeoutMs = UI_AUTO_MASK_TIMEOUT_MS,
}: CredentialRevealViewProps) {
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const maskTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function maskNow() {
    if (maskTimer.current !== null) {
      clearTimeout(maskTimer.current);
      maskTimer.current = null;
    }
    setPassword(null); // conditional render below actually removes the node, not just hides it
    setCopyConfirmed(false);
  }

  useEffect(() => {
    // Unmounting (e.g. the vault is locked while revealed) must not
    // leave a stale timer trying to mask a password that's already gone.
    return () => {
      if (maskTimer.current !== null) clearTimeout(maskTimer.current);
      if (clearTimer.current !== null) clearTimeout(clearTimer.current);
    };
  }, []);

  async function handleReveal() {
    setError(null);
    setBusy(true);
    try {
      const revealed = await revealPassword();
      setPassword(revealed);
      setCopyConfirmed(false);
      maskTimer.current = setTimeout(maskNow, autoMaskTimeoutMs);
    } catch (revealError) {
      setError(revealError instanceof Error ? revealError.message : String(revealError));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (password === null) return;
    const adapter = clipboardAdapter ?? (await getClipboardAdapter());
    await adapter.writeText(password);
    setCopyConfirmed(true);
    if (clearTimer.current !== null) clearTimeout(clearTimer.current);
    clearTimer.current = scheduleClipboardAutoClear(adapter, password);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    // Only mask if focus actually left this view -- not when it just
    // moved from one child (e.g. "Reveal") to another (e.g. "Copy").
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      maskNow();
    }
  }

  return (
    <div onBlur={handleBlur}>
      <h2 className="jano-heading">{title}</h2>
      <p className="jano-text">Username: {username}</p>
      {password === null ? (
        <button type="button" className="jano-button" onClick={handleReveal} disabled={busy} data-crypto-active={busy}>
          {busy ? 'Decrypting...' : 'Reveal password'}
        </button>
      ) : (
        <p className="jano-credential" data-copy-confirmed={copyConfirmed}>
          Password: <code className="jano-mono">{password}</code>{' '}
          <button type="button" className="jano-button" onClick={handleCopy}>
            Copy
          </button>{' '}
          <button type="button" className="jano-button" onClick={maskNow}>
            Hide
          </button>
          {copyConfirmed && <span className="jano-credential-confirmation"> [COPIED] Copied to clipboard.</span>}
        </p>
      )}
      {error && <p role="alert" className="jano-error">{error}</p>}
    </div>
  );
}
