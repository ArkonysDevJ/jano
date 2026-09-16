import { describe, expect, it } from 'vitest';
import { HttpOpaqueRotationClient, fromBase64, toBase64 } from '../rotation-http-client';

/**
 * REAL round-trip against @cloudflare/opaque-ts's cryptography on the
 * client side (via opaque-client.ts, unmocked) -- only the NETWORK is
 * faked, with a real `OpaqueServer` answering the mocked fetch's
 * /auth/rotate/start exactly like apps/api's CloudflareOpaqueServerProvider
 * would (same library, same call shape -- see that file and its own
 * spec for the pattern this mirrors). This is the only thing worth
 * faking here: HttpOpaqueRotationClient has no business knowing it's
 * not talking to a real NestJS server, only that fetch resolves with
 * the right shape.
 */
describe('HttpOpaqueRotationClient (real OPAQUE math, faked network)', () => {
  it('completes a Factor-1-only rotation: start -> finish, with the right method/headers/paths', async () => {
    const opaque = await import('@cloudflare/opaque-ts');

    const cfg = opaque.getOpaqueConfig(opaque.OpaqueID.OPAQUE_P256);
    const oprfSeed = crypto.getRandomValues(new Uint8Array(cfg.constants.Nseed));
    const akeKeypairExport = await cfg.ake.generateAuthKeyPair();
    const server = new opaque.OpaqueServer(cfg, Array.from(oprfSeed), akeKeypairExport);
    const credentialIdentifier = 'device-under-test';

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body as string) as { registrationRequest?: string };

      if (path === '/auth/rotate/start') {
        const registrationRequest = opaque.RegistrationRequest.deserialize(
          cfg,
          Array.from(fromBase64(body.registrationRequest!)),
        );
        const result = await server.registerInit(registrationRequest, credentialIdentifier);
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

    const client = new HttpOpaqueRotationClient({
      baseUrl: 'https://api.example.test',
      getToken: () => 'a-session-token',
      fetchImpl,
    });

    await client.reregister('new-master-password');

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://api.example.test/auth/rotate/start');
    expect(calls[1].url).toBe('https://api.example.test/auth/rotate/finish');
    for (const { init } of calls) {
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer a-session-token');
    }

    // The finish body really is a well-formed OPAQUE record for this
    // server's config -- not just "some base64 string got sent".
    const finishBody = JSON.parse(calls[1].init.body as string) as { registrationRecord: string };
    expect(() =>
      opaque.RegistrationRecord.deserialize(cfg, Array.from(fromBase64(finishBody.registrationRecord))),
    ).not.toThrow();
  });

  it('refuses hardened-mode (Factor 2) accounts with a clear backlog error, without calling finish', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(new URL(url).pathname);
      return new Response(
        JSON.stringify({ registrationResponse: toBase64(new Uint8Array([1])), continuityChallenge: toBase64(new Uint8Array([2])) }),
        { status: 200 },
      );
    }) as typeof fetch;

    const client = new HttpOpaqueRotationClient({
      baseUrl: 'https://api.example.test',
      getToken: () => 'token',
      fetchImpl,
    });

    await expect(client.reregister('new-password')).rejects.toThrow(/hardened mode/i);
    expect(calls).toEqual(['/auth/rotate/start']); // finish is never attempted
  });

  it('surfaces a failed /auth/rotate/start with the path and status in the error', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: 'Invalid or expired token.' }), { status: 401 })) as typeof fetch;

    const client = new HttpOpaqueRotationClient({
      baseUrl: 'https://api.example.test',
      getToken: () => 'expired-token',
      fetchImpl,
    });

    await expect(client.reregister('new-password')).rejects.toThrow(/401/);
  });
});

describe('toBase64 / fromBase64', () => {
  it('round-trips arbitrary bytes, including 0x00 and 0xff', () => {
    const original = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(fromBase64(toBase64(original))).toEqual(original);
  });
});
