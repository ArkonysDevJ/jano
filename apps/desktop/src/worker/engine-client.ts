/**
 * Main-thread client for the engine Worker.
 * Reference: docs/ARCHITECTURE-01.md, section 9; protocol.ts for the
 * message contract this class speaks.
 *
 * This is the ONLY thing the UI layer should use to talk to the
 * engine -- no screen should `postMessage` to the worker itself or
 * import engine.worker.ts directly. One `EngineClient` per active
 * session: one worker underneath it, one resident `KeyManager` inside
 * that worker (engine.worker.ts).
 */

import type { EngineOp, EngineOpMap, EngineRequestMessage, EngineResponseMessage } from './protocol';

interface PendingCall {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

export class EngineClient {
  #worker: Worker;
  #nextId = 1;
  #pending = new Map<number, PendingCall>();

  constructor() {
    // The `new URL(..., import.meta.url)` form is Vite's documented
    // worker-construction pattern -- it bundles engine.worker.ts as its
    // own module chunk. Works unchanged in a plain browser tab (the
    // future web demo) and inside a Tauri webview, since it's a
    // standard Web Worker either way -- no Tauri API involved here.
    this.#worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.#worker.onmessage = (event: MessageEvent<EngineResponseMessage>) => {
      this.#handleResponse(event.data);
    };
    this.#worker.onerror = (event: ErrorEvent) => {
      // A worker-level failure (a syntax error, an uncaught throw
      // outside engine.worker.ts's own try/catch) has no request `id`
      // to correlate -- reject every call still in flight instead of
      // leaving it hanging forever.
      this.#rejectAll(new Error(event.message || 'Engine worker crashed.'));
    };
  }

  /** Low-level escape hatch -- prefer the named methods below in UI code. */
  call<Op extends EngineOp>(op: Op, payload: EngineOpMap[Op]['request']): Promise<EngineOpMap[Op]['result']> {
    const id = this.#nextId++;
    const message: EngineRequestMessage<Op> = { id, op, payload };
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      this.#worker.postMessage(message);
    });
  }

  createNewVault(
    masterPassword: string,
    params?: EngineOpMap['createNewVault']['request']['params'],
  ): Promise<EngineOpMap['createNewVault']['result']> {
    return this.call('createNewVault', { masterPassword, params });
  }

  async unlockWithPassword(
    masterPassword: string,
    localSalt: EngineOpMap['unlockWithPassword']['request']['localSalt'],
    wrapped: EngineOpMap['unlockWithPassword']['request']['wrapped'],
    params?: EngineOpMap['unlockWithPassword']['request']['params'],
  ): Promise<void> {
    await this.call('unlockWithPassword', { masterPassword, localSalt, wrapped, params });
  }

  async lock(): Promise<void> {
    await this.call('lock', {});
  }

  async encryptItem(plaintext: EngineOpMap['encryptItem']['request']['plaintext']) {
    const { ciphertext } = await this.call('encryptItem', { plaintext });
    return ciphertext;
  }

  async decryptItem(packed: EngineOpMap['decryptItem']['request']['packed']) {
    const { plaintext } = await this.call('decryptItem', { packed });
    return plaintext;
  }

  /** Terminates the worker outright (e.g. logout) -- in addition to, not instead of, calling `lock()` first. */
  terminate(): void {
    this.#worker.terminate();
    this.#rejectAll(new Error('Engine worker terminated.'));
  }

  #handleResponse(response: EngineResponseMessage): void {
    const pending = this.#pending.get(response.id);
    if (!pending) return; // stale/unknown id -- ignore rather than throw
    this.#pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(new Error(response.error));
    }
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
