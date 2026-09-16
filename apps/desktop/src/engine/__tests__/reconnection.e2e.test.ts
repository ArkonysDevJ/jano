import { describe, expect, it } from 'vitest';
import { installFakeIndexedDB } from './support/fake-indexeddb';
import { createNewVault } from '../registration';
import { beginOfflineRotation } from '../rotation-state-machine';
import { deriveMasterKek, DEFAULT_ARGON2ID_PARAMS } from '../kek';
import { IndexedDbPendingRotationStore } from '../indexeddb-pending-rotation-store';
import { toBase64, fromBase64 } from '../rotation-http-client';
import { reconnect } from '../reconnection';

/**
 * Closes the loop this session's three pieces (opaque-client.ts,
 * rotation-state-machine.ts, rotation-http-client.ts) were each built
 * and unit-tested in isolation for: a full offline-rotation ->
 * reconnection cycle, through the REAL local storage adapter
 * (IndexedDbPendingRotationStore, against a fake IndexedDB -- see that
 * file) and REAL OPAQUE cryptography (@cloudflare/opaque-ts, only the
 * network is faked -- same pattern as rotation-http-client.test.ts).
 * Nothing here is a placeholder standing in for a piece that doesn't
 * exist yet; every piece this test drives is the real implementation.
 */
describe('offline rotation -> reconnect, end to end', () => {
  it('persists a pending rotation to IndexedDB while offline, then completes it against a real OPAQUE server on reconnect', async () => {
    installFakeIndexedDB();

    const opaque = await import('@cloudflare/opaque-ts');
    const cfg = opaque.getOpaqueConfig(opaque.OpaqueID.OPAQUE_P256);
    const oprfSeed = crypto.getRandomValues(new Uint8Array(cfg.constants.Nseed));
    const akeKeypairExport = await cfg.ake.generateAuthKeyPair();
    const server = new opaque.OpaqueServer(cfg, Array.from(oprfSeed), akeKeypairExport);
    const credentialIdentifier = 'reconnect-e2e@example.com';

    // --- Offline: vault exists, master password rotates with no network. ---
    const oldPassword = 'old-master-password';
    const material = await createNewVault(oldPassword, DEFAULT_ARGON2ID_PARAMS);

    const newPassword = 'new-master-password-after-offline-rotation';
    const newLocalSalt = crypto.getRandomValues(new Uint8Array(16));
    const store = new IndexedDbPendingRotationStore('e2e-device');

    await beginOfflineRotation({
      manager: material.manager,
      newMasterPassword: newPassword,
      newLocalSalt,
      newKeyVersion: 2,
      localRotationEpoch: 1,
      store,
    });

    // The pending record genuinely landed in (fake) IndexedDB, not just
    // in some in-memory variable this test happens to still hold.
    expect(await store.load()).not.toBeNull();

    // --- Reconnection: network is back, hand off to the real API (faked here). ---
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push(path);
      const body = JSON.parse(init.body as string) as { registrationRequest?: string };

      if (path === '/auth/rotate/start') {
        const request = opaque.RegistrationRequest.deserialize(
          cfg,
          Array.from(fromBase64(body.registrationRequest!)),
        );
        const result = await server.registerInit(request, credentialIdentifier);
        if (result instanceof Error) throw result;
        return new Response(
          JSON.stringify({ registrationResponse: toBase64(Uint8Array.from(result.serialize())) }),
          { status: 200 },
        );
      }
      if (path === '/auth/rotate/finish') {
        return new Response(JSON.stringify({ rotated: true }), { status: 201 });
      }
      throw new Error(`unexpected path: ${path}`);
    }) as typeof fetch;

    const newKek = await deriveMasterKek(newPassword, newLocalSalt, DEFAULT_ARGON2ID_PARAMS);

    const result = await reconnect({
      kek: newKek,
      store,
      http: { baseUrl: 'https://api.example.test', getToken: () => 'a-session-token', fetchImpl },
    });

    expect(result.completed).toBe(true);
    expect(calls).toEqual(['/auth/rotate/start', '/auth/rotate/finish']);

    // Two-phase idempotency, now proven through the REAL store: the
    // record is gone only because the server round-trip actually
    // succeeded, not just because some in-memory flag was flipped.
    expect(await store.load()).toBeNull();
  });

  it('leaves the record in IndexedDB if the server round-trip fails, so the next reconnection attempt still finds it', async () => {
    installFakeIndexedDB();

    const oldPassword = 'old-master-password';
    const material = await createNewVault(oldPassword, DEFAULT_ARGON2ID_PARAMS);
    const newPassword = 'new-master-password';
    const newLocalSalt = crypto.getRandomValues(new Uint8Array(16));
    const store = new IndexedDbPendingRotationStore('e2e-device-2');

    await beginOfflineRotation({
      manager: material.manager,
      newMasterPassword: newPassword,
      newLocalSalt,
      newKeyVersion: 2,
      localRotationEpoch: 1,
      store,
    });

    const failingFetch = (async () => new Response('', { status: 401 })) as typeof fetch;
    const newKek = await deriveMasterKek(newPassword, newLocalSalt, DEFAULT_ARGON2ID_PARAMS);

    await expect(
      reconnect({
        kek: newKek,
        store,
        http: { baseUrl: 'https://api.example.test', getToken: () => 'expired', fetchImpl: failingFetch },
      }),
    ).rejects.toThrow();

    expect(await store.load()).not.toBeNull(); // still there for the next attempt
  });
});
