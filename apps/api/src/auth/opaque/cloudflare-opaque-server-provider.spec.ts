import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CloudflareOpaqueServerProvider } from './cloudflare-opaque-server-provider.js';

/**
 * REAL round-trip against @cloudflare/opaque-ts@0.7.5's cryptography --
 * not against FakeOpaqueServerProvider. Unlike auth.service.spec.ts
 * (which exercises AuthService's control flow), this test is the only
 * verification that CloudflareOpaqueServerProvider correctly speaks the
 * real protocol: full registration + full login, using a real
 * `OpaqueClient` on the "client" side (simulated here, in the same
 * process) against the real `OpaqueServer` this provider wraps.
 *
 * This file could not be run in the sandbox where it was written
 * (npm registry blocked there; @cloudflare/opaque-ts only actually
 * installed on André's machine) -- it was run there on 2026-09-11,
 * confirming the happy path (matching sessionKey derived independently
 * by client and server) on the first try, and taking two corrected
 * passes to get the wrong-password test's assertion right (see that
 * test's comment for the real client-side, resolve-not-reject shape of
 * the failure). Run with:
 *   npm run test --workspace=apps/api -- cloudflare-opaque-server-provider
 */
describe('CloudflareOpaqueServerProvider (real round-trip)', () => {
  it('completes registration and login end-to-end, and both sides derive the same sessionKey', async () => {
    const opaque = await import('@cloudflare/opaque-ts');
    const { randomBytes } = await import('node:crypto');

    const cfg = opaque.getOpaqueConfig(opaque.OpaqueID.OPAQUE_P256);

    // "Server" secrets -- generated here for this test only, never the
    // real ones from any .env. A real server generates them ONCE with
    // scripts/generate-opaque-server-secrets.mjs.
    const oprfSeed = randomBytes(cfg.constants.Nseed);
    const akeKeypairExport = await cfg.ake.generateAuthKeyPair();

    process.env.OPAQUE_OPRF_SEED_B64 = oprfSeed.toString('base64');
    process.env.OPAQUE_AKE_PRIVATE_KEY_B64 = Buffer.from(akeKeypairExport.private_key).toString('base64');
    process.env.OPAQUE_AKE_PUBLIC_KEY_B64 = Buffer.from(akeKeypairExport.public_key).toString('base64');

    const provider = new CloudflareOpaqueServerProvider();
    const email = 'ana@example.com';
    const password = 'a-test-password-not-real';

    const client = new opaque.OpaqueClient(cfg);

    // --- Registration ---
    const registrationRequest = await client.registerInit(password);
    if (registrationRequest instanceof Error) throw registrationRequest;

    const { registrationResponse } = await provider.createRegistrationResponse({
      credentialIdentifier: email,
      registrationRequest: Uint8Array.from(registrationRequest.serialize()),
    });

    const deserializedResponse = opaque.RegistrationResponse.deserialize(cfg, Array.from(registrationResponse));
    const registerResult = await client.registerFinish(deserializedResponse);
    if (registerResult instanceof Error) throw registerResult;

    // What the real API would store in users.registration_record.
    const storedRegistrationRecord = Uint8Array.from(registerResult.record.serialize());

    // --- Login ---
    const ke1 = await client.authInit(password);
    if (ke1 instanceof Error) throw ke1;

    const { ke2, loginState } = await provider.createLoginResponse({
      credentialIdentifier: email,
      registrationRecord: storedRegistrationRecord,
      ke1: Uint8Array.from(ke1.serialize()),
    });

    const deserializedKe2 = opaque.KE2.deserialize(cfg, Array.from(ke2));
    const authFinishResult = await client.authFinish(deserializedKe2);
    if (authFinishResult instanceof Error) throw authFinishResult;

    const { sessionKey } = await provider.finishLogin({
      loginState,
      ke3: Uint8Array.from(authFinishResult.ke3.serialize()),
    });

    // The property that actually matters: server and client
    // independently derived the SAME sessionKey -- that's what shows
    // the AKE handshake closed correctly.
    expect(Array.from(sessionKey)).toEqual(authFinishResult.session_key);
  });

  /**
   * Guards the 2026-09-15 fix: a malformed registrationRequest (e.g. a
   * Bruno placeholder body sent to rotate/start, as happened in
   * practice) used to crash several frames deep inside voprf-ts's
   * Group.deserialize with an uncaught exception -- NestJS's default
   * filter turned that into an opaque 500 with no useful message. It
   * must now surface as a clean, client-attributable 400 instead.
   */
  it('rejects a malformed registrationRequest with a clean BadRequestException, not an uncaught crash', async () => {
    const { randomBytes } = await import('node:crypto');
    const opaque = await import('@cloudflare/opaque-ts');
    const cfg = opaque.getOpaqueConfig(opaque.OpaqueID.OPAQUE_P256);
    const oprfSeed = randomBytes(cfg.constants.Nseed);
    const akeKeypairExport = await cfg.ake.generateAuthKeyPair();

    process.env.OPAQUE_OPRF_SEED_B64 = oprfSeed.toString('base64');
    process.env.OPAQUE_AKE_PRIVATE_KEY_B64 = Buffer.from(akeKeypairExport.private_key).toString('base64');
    process.env.OPAQUE_AKE_PUBLIC_KEY_B64 = Buffer.from(akeKeypairExport.public_key).toString('base64');

    const provider = new CloudflareOpaqueServerProvider();

    // The exact shape of mistake this guards against: the literal
    // placeholder text from bruno/rotation/start.bru's body, as bytes --
    // not real OPRF-blinded output from an OpaqueClient.
    const placeholder = Buffer.from(
      '<base64 output of a real OpaqueClient.registerInit() for the NEW password -- see ../README.md>',
    );

    await expect(
      provider.createRegistrationResponse({
        credentialIdentifier: 'someone@example.com',
        registrationRequest: new Uint8Array(placeholder),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects the login if the password does not match (client-side envelope recovery fails)', async () => {
    const opaque = await import('@cloudflare/opaque-ts');
    const { randomBytes } = await import('node:crypto');

    const cfg = opaque.getOpaqueConfig(opaque.OpaqueID.OPAQUE_P256);
    const oprfSeed = randomBytes(cfg.constants.Nseed);
    const akeKeypairExport = await cfg.ake.generateAuthKeyPair();

    process.env.OPAQUE_OPRF_SEED_B64 = oprfSeed.toString('base64');
    process.env.OPAQUE_AKE_PRIVATE_KEY_B64 = Buffer.from(akeKeypairExport.private_key).toString('base64');
    process.env.OPAQUE_AKE_PUBLIC_KEY_B64 = Buffer.from(akeKeypairExport.public_key).toString('base64');

    const provider = new CloudflareOpaqueServerProvider();
    const email = 'bruno@example.com';
    const client = new opaque.OpaqueClient(cfg);

    const registrationRequest = await client.registerInit('correct-password');
    if (registrationRequest instanceof Error) throw registrationRequest;
    const { registrationResponse } = await provider.createRegistrationResponse({
      credentialIdentifier: email,
      registrationRequest: Uint8Array.from(registrationRequest.serialize()),
    });
    const registerResult = await client.registerFinish(
      opaque.RegistrationResponse.deserialize(cfg, Array.from(registrationResponse)),
    );
    if (registerResult instanceof Error) throw registerResult;
    const storedRegistrationRecord = Uint8Array.from(registerResult.record.serialize());

    // The attacker tries with a password different from the registered one.
    const attackerClient = new opaque.OpaqueClient(cfg);
    const ke1 = await attackerClient.authInit('wrong-password');
    if (ke1 instanceof Error) throw ke1;

    // loginState is intentionally unused below: the point of this test
    // is that the attacker's client never gets far enough to produce a
    // KE3, so provider.finishLogin (which would need it) is never
    // called.
    const { ke2 } = await provider.createLoginResponse({
      credentialIdentifier: email,
      registrationRecord: storedRegistrationRecord,
      ke1: Uint8Array.from(ke1.serialize()),
    });

    // Real behavior (confirmed 2026-09-11, running against the actual
    // library on André's machine, not a stub, in two corrected passes):
    // the rejection happens on the CLIENT side, not the server side. To
    // even build a KE3, the client must first unmask the OPRF output
    // with its (wrong) password, then use that output to decrypt and
    // verify its own credential envelope (see the KE2 payload in the
    // real OPAQUE protocol). With the wrong password, the OPRF output
    // is garbage, so the envelope decryption/MAC check fails INSIDE the
    // client -- it never manages to produce a KE3 to send to the server
    // at all. This is a stronger guarantee than "the server rejects a
    // bad KE3": the protocol's math aborts the operation on the
    // attacker's own device the moment the envelope doesn't open,
    // before any network round-trip with a forged KE3 is even possible.
    //
    // The library follows the same "return an Error value, don't throw
    // it" convention here as everywhere else in this file (see
    // registerInit/authInit above) -- authFinish's promise RESOLVES
    // with an EnvelopeRecoveryError instance, it does not reject. Two
    // wrong assumptions were made and corrected in this same session
    // before landing on the right assertion: first, that the server
    // would reject a successfully-built KE3 (it never gets built);
    // second, that the client-side failure would surface as a rejected
    // promise (it doesn't -- it resolves with an Error, like the rest
    // of this library's API).
    const authFinishResult = await attackerClient.authFinish(opaque.KE2.deserialize(cfg, Array.from(ke2)));
    expect(authFinishResult).toBeInstanceOf(Error);
  });
});
