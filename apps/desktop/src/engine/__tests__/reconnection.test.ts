import { describe, expect, it } from 'vitest';
import { reconnect } from '../reconnection';
import type { PendingRotationStore } from '../rotation-state-machine';
import type { Bytes } from '../types';

class EmptyStore implements PendingRotationStore {
  async save(): Promise<void> {
    throw new Error('should not be called in this test');
  }
  async load(): Promise<Bytes | null> {
    return null;
  }
  async clear(): Promise<void> {
    throw new Error('should not be called in this test');
  }
}

describe('reconnect (orchestrator)', () => {
  it('is a no-op, and never touches the network, when there is nothing pending', async () => {
    const fetchImpl = (async () => {
      throw new Error('should never be called -- nothing pending, so no request is needed');
    }) as typeof fetch;

    const result = await reconnect({
      kek: crypto.getRandomValues(new Uint8Array(32)) as Bytes,
      store: new EmptyStore(),
      http: { baseUrl: 'https://api.example.test', getToken: () => 'token', fetchImpl },
    });

    expect(result.completed).toBe(false);
  });
});
