/**
 * Real network implementation of `OpaqueRotationClient` (see
 * rotation-state-machine.ts) -- the piece that file's header comment
 * deliberately left unbuilt there: completing a pending offline
 * rotation (section 13, step 3) means calling
 * POST /auth/rotate/start -> POST /auth/rotate/finish against
 * apps/api/src/rotation, with real OPAQUE client math (opaque-client.ts)
 * in between. This module is where that finally happens.
 *
 * Uses the global `fetch` (injectable for tests) rather than a Tauri
 * command: apps/desktop targets Tauri (see package.json), but Tauri's
 * webview is a real browser context, and a plain HTTPS fetch to the
 * API works there exactly as it would in any other webview -- no
 * native command is needed just to make an HTTP request. If a future
 * requirement needs the native layer specifically (e.g. certificate
 * pinning), only this module's `fetchImpl` default needs to change --
 * callers that already inject their own are unaffected.
 *
 * base64 helpers here use btoa/atob rather than Buffer (not available
 * in a webview by default) or the newer
 * Uint8Array.prototype.toBase64()/fromBase64() (not reliably available
 * across every WebView2/WebKitGTK version Tauri may run on yet).
 * btoa/atob are universally supported and sufficient for the small
 * (well under 1KB) OPAQUE payloads this module handles.
 */

import { finishRegistration, startRegistration } from './opaque-client';
import type { OpaqueRotationClient } from './rotation-state-machine';

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface RotationHttpConfig {
  /** e.g. "http://localhost:3000" in dev, the real API origin in production. */
  readonly baseUrl: string;
  /**
   * A session OR refresh token for the device attempting rotation
   * (Factor 1 -- RotationAuthGuard accepts either, see that file). A
   * function, not a plain string: reconnection can happen well after
   * the caller obtained the token, so this is called fresh on every
   * request instead of capturing one value that may already be stale.
   */
  getToken(): string | Promise<string>;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

interface RotateStartResponse {
  readonly registrationResponse: string;
  readonly continuityChallenge?: string;
}

/**
 * Real implementation of the interface rotation-state-machine.ts
 * declares and completeOfflineRotation() calls. Factor-1-only accounts
 * only, matching the current server-side fixture coverage
 * (opaque-bruno-fixture.mjs) and this session's 2026-09-15 scope
 * decision: hardened-mode (Factor 2) rotation from the desktop client
 * is explicitly backlogged for the final hardening phase, not silently
 * unsupported -- see the error thrown below.
 */
export class HttpOpaqueRotationClient implements OpaqueRotationClient {
  constructor(private readonly config: RotationHttpConfig) {}

  async reregister(recoveredPassword: string): Promise<void> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const token = await this.config.getToken();

    const { registrationRequest, client } = await startRegistration(recoveredPassword);

    const startResponse = await this.#post<RotateStartResponse>(fetchImpl, token, '/auth/rotate/start', {
      registrationRequest: toBase64(registrationRequest),
    });

    if (startResponse.continuityChallenge) {
      // Factor 2 (hardened mode): this account was registered with a
      // continuitySecret, so rotate/finish also needs a
      // continuitySignature (HMAC-SHA256 over the challenge, see
      // rotation.service.ts) -- the desktop client has no continuity
      // material to sign with yet. Refusing loudly, rather than
      // silently dropping Factor 2 and hoping rotate/finish's own
      // guard catches it, is deliberate: completeOfflineRotation
      // leaves the pending record in place on any thrown error, so
      // this is safe to retry once the desktop client supports Factor 2.
      throw new Error(
        'This account has hardened mode enabled (Factor 2 continuity signature) -- ' +
          'the desktop client does not implement it yet (backlogged for the final ' +
          'hardening phase, 2026-09-15). Offline rotation cannot complete ' +
          'automatically for this account; the pending record is left in place.',
      );
    }

    const registrationRecord = await finishRegistration(
      client,
      fromBase64(startResponse.registrationResponse),
    );

    await this.#post(fetchImpl, token, '/auth/rotate/finish', {
      registrationRecord: toBase64(registrationRecord),
    });
  }

  async #post<T = unknown>(
    fetchImpl: typeof fetch,
    token: string,
    path: string,
    body: Record<string, string>,
  ): Promise<T> {
    const response = await fetchImpl(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${path} -> HTTP ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }
}
