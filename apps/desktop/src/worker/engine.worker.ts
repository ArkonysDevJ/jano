/**
 * Engine Worker entry point.
 * Reference: docs/ARCHITECTURE-01.md, section 9; protocol.ts for the
 * message contract this file implements the worker side of.
 *
 * Holds the ONE resident `KeyManager` for the active session. Nothing
 * in this file ever posts the DEK, a KEK, or the `KeyManager` instance
 * itself back to the main thread -- only the plain data each
 * operation's contract (protocol.ts) declares.
 */

import { createNewVault } from '../engine/registration';
import { deriveMasterKek } from '../engine/kek';
import { KeyManager } from '../engine/key-manager';
import type {
  EngineOp,
  EngineRequestMessage,
  EngineResponseMessage,
} from './protocol';

/**
 * Minimal local shape for the worker global scope, declared instead of
 * relying on the ambient "webworker" lib type (`DedicatedWorkerGlobalScope`):
 * that lib declares its own global `self` and conflicts with this
 * project's "dom" lib (tsconfig.json), which also declares a global
 * `self` of a different type. This file only needs these two members
 * of it, so it declares just those instead of pulling in the whole lib.
 */
declare const self: {
  onmessage: ((event: MessageEvent<EngineRequestMessage>) => void) | null;
  postMessage(message: EngineResponseMessage): void;
};

/**
 * Replaced wholesale by `createNewVault()` (its `manager` is already
 * unlocked with the freshly-generated DEK) -- otherwise the same
 * instance for the whole life of this worker.
 */
let activeManager = new KeyManager();

async function handle(op: EngineOp, payload: unknown): Promise<unknown> {
  switch (op) {
    case 'createNewVault': {
      const { masterPassword, params } =
        payload as EngineRequestMessage<'createNewVault'>['payload'];
      const material = await createNewVault(masterPassword, params);
      activeManager = material.manager;
      return {
        localSalt: material.localSalt,
        recoverySalt: material.recoverySalt,
        recoveryKitSecret: material.recoveryKitSecret,
        wrappedMasterDek: material.wrappedMasterDek,
        wrappedRecoveryDek: material.wrappedRecoveryDek,
      };
    }

    case 'unlockWithPassword': {
      const { masterPassword, localSalt, wrapped, params } =
        payload as EngineRequestMessage<'unlockWithPassword'>['payload'];
      const kek = await deriveMasterKek(masterPassword, localSalt, params);
      await activeManager.unlockWith(kek, wrapped); // unlockWith() zeroizes kek itself
      return { unlocked: true as const };
    }

    case 'lock': {
      activeManager.lock();
      return { locked: true as const };
    }

    case 'encryptItem': {
      const { plaintext } = payload as EngineRequestMessage<'encryptItem'>['payload'];
      const ciphertext = await activeManager.encryptItem(plaintext);
      return { ciphertext };
    }

    case 'decryptItem': {
      const { packed } = payload as EngineRequestMessage<'decryptItem'>['payload'];
      const plaintext = await activeManager.decryptItem(packed);
      return { plaintext };
    }

    default: {
      // Exhaustiveness guard -- a new EngineOp added to protocol.ts
      // without a case here fails compilation, not silently at runtime.
      const _never: never = op;
      throw new Error(`Unknown engine op: ${String(_never)}`);
    }
  }
}

self.onmessage = (event: MessageEvent<EngineRequestMessage>) => {
  const { id, op, payload } = event.data;
  handle(op, payload).then(
    (result) => {
      self.postMessage({ id, ok: true, result } as EngineResponseMessage);
    },
    (error: unknown) => {
      self.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );
};
