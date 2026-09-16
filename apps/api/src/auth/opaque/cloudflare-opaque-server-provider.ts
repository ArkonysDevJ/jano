import { BadRequestException, Injectable } from '@nestjs/common';
import type { OpaqueLoginState, OpaqueServerProvider } from './opaque-server-provider.js';

/**
 * Real @cloudflare/opaque-ts module, loaded once via dynamic import()
 * (see note below). `resolution-mode: 'import'` is mandatory here --
 * without it, TypeScript rejects the type-only import of a pure ESM
 * package from a CommonJS file (TS1542), even though the real runtime
 * import is dynamic.
 */
type OpaqueModule = typeof import('@cloudflare/opaque-ts', { with: { 'resolution-mode': 'import' } });
type OpaqueServerHandle = InstanceType<OpaqueModule['OpaqueServer']>;
type OpaqueConfigHandle = ReturnType<OpaqueModule['getOpaqueConfig']>;

interface Ready {
  readonly mod: OpaqueModule;
  readonly server: OpaqueServerHandle;
  readonly cfg: OpaqueConfigHandle;
}

/**
 * Real implementation against @cloudflare/opaque-ts@0.7.5 -- read
 * directly from its .d.ts files installed on André's machine (via
 * device_stage_files, 2026-09-11), not fabricated from memory. Three
 * details of the real API that weren't evident from the protocol in
 * the abstract and that change this handoff's original design:
 *
 * 1. @cloudflare/opaque-ts is a pure ESM package
 *    (`"type": "module"` in its package.json, no `exports` field).
 *    `apps/api` is still CommonJS (see tsconfig.json) -- Node CANNOT
 *    `require()` a pure ESM package. That's why this file has no
 *    static runtime `import` of the library, only types (which
 *    TypeScript erases at compile time) and a dynamic `import()`,
 *    cached once in `getReady()`.
 *
 * 2. `oprf_seed` is NOT a per-user secret -- it is a secret UNIQUE to
 *    the whole server deployment. `OpaqueServer` receives it in its
 *    constructor (not on each call) and internally derives each
 *    `credential_identifier`'s OPRF key from that global seed (see
 *    `LABELS.OprfKey` in the library, and the "Credential Retrieval"
 *    section of the draft RFC it implements). This corrects the
 *    original design of docs/schema.sql, which stored `oprf_seed` per
 *    row in `users` -- that column no longer exists.
 *
 * 3. The server's AKE keypair is also not per user: it's the server's
 *    static keypair for the 3DH handshake, generated ONCE and reused
 *    on every login. Generated with `config.ake.generateAuthKeyPair()`
 *    (there is no AKE class exported directly from the library's
 *    public index).
 *
 * Both secrets (`oprf_seed` and the AKE keypair) are loaded from
 * base64 environment variables -- see `.env.example` and
 * `scripts/generate-opaque-server-secrets.mjs` to generate them once.
 * They are NEVER generated on the fly on each startup: that would
 * invalidate every existing OPAQUE registration at once.
 *
 * VERIFICATION: this file compiles cleanly against the real 0.7.5
 * .d.ts files (tsc --strict --noEmit, with hand-written stubs for the
 * rest of the type graph because the npm registry is still blocked in
 * the sandbox). A real round-trip against the library's cryptography
 * has NOT been run -- that requires @cloudflare/opaque-ts actually
 * installed, which only exists on André's machine. See
 * `cloudflare-opaque-server-provider.spec.ts`: that test DOES perform
 * a full round-trip (registration + login) against real `OpaqueClient`
 * and `OpaqueServer`, but it can only run there -- it is the pending
 * verification before moving the binding in auth.module.ts.
 */
@Injectable()
export class CloudflareOpaqueServerProvider implements OpaqueServerProvider {
  private ready: Promise<Ready> | undefined;

  private getReady(): Promise<Ready> {
    if (!this.ready) {
      this.ready = this.init();
    }
    return this.ready;
  }

  private async init(): Promise<Ready> {
    const mod = await import('@cloudflare/opaque-ts');
    const cfg = mod.getOpaqueConfig(mod.OpaqueID.OPAQUE_P256);

    const oprfSeedB64 = process.env.OPAQUE_OPRF_SEED_B64;
    const akePrivateKeyB64 = process.env.OPAQUE_AKE_PRIVATE_KEY_B64;
    const akePublicKeyB64 = process.env.OPAQUE_AKE_PUBLIC_KEY_B64;
    if (!oprfSeedB64 || !akePrivateKeyB64 || !akePublicKeyB64) {
      throw new Error(
        'Missing OPAQUE_OPRF_SEED_B64 / OPAQUE_AKE_PRIVATE_KEY_B64 / OPAQUE_AKE_PUBLIC_KEY_B64 ' +
          '-- run scripts/generate-opaque-server-secrets.mjs ONCE and store the result ' +
          '(see .env.example). Generating them on every startup would invalidate all existing registrations.',
      );
    }

    const oprfSeed = Array.from(Buffer.from(oprfSeedB64, 'base64'));
    const akeKeypairExport = {
      private_key: Array.from(Buffer.from(akePrivateKeyB64, 'base64')),
      public_key: Array.from(Buffer.from(akePublicKeyB64, 'base64')),
    };

    const server = new mod.OpaqueServer(cfg, oprfSeed, akeKeypairExport);
    return { mod, server, cfg };
  }

  /**
   * `registrationRequest` is caller-supplied, unauthenticated bytes --
   * both register/start (anyone) and rotate/start (Factor 1 only) reach
   * this method before there's any way to know the bytes are well-formed
   * OPAQUE/OPRF protocol data. Malformed input (confirmed in practice,
   * 2026-09-15: a Bruno placeholder body sent to rotate/start) doesn't
   * fail cleanly -- `voprf-ts`'s `Group.deserialize` throws several
   * frames deep inside `server.registerInit()`'s OPRF evaluation (an
   * invalid elliptic-curve point), past the outer
   * `RegistrationRequest.deserialize` above, which only checks the
   * envelope's byte layout, not that the encoded point is actually on
   * the curve. Both failure points are wrapped here -- neither is ever
   * a server-side condition, only ever the client's bytes being wrong --
   * and turned into a clean 400 instead of an uncaught exception that
   * NestJS's default filter would otherwise turn into an opaque,
   * unhelpful 500.
   */
  async createRegistrationResponse(input: {
    credentialIdentifier: string;
    registrationRequest: Uint8Array;
  }): Promise<{ registrationResponse: Uint8Array }> {
    const { mod, server, cfg } = await this.getReady();

    let result;
    try {
      const request = mod.RegistrationRequest.deserialize(cfg, Array.from(input.registrationRequest));
      result = await server.registerInit(request, input.credentialIdentifier);
    } catch {
      throw new BadRequestException('registrationRequest is not well-formed OPAQUE protocol data.');
    }

    if (result instanceof Error) {
      // Same client-data-fault category as the catch above -- this
      // library sometimes signals malformed/invalid input by resolving
      // with an Error value instead of throwing (see
      // isValidRegistrationRecord's comment on this same inconsistency).
      throw new BadRequestException('registrationRequest is not well-formed OPAQUE protocol data.');
    }

    return { registrationResponse: Uint8Array.from(result.serialize()) };
  }

  async createLoginResponse(input: {
    credentialIdentifier: string;
    registrationRecord: Uint8Array;
    ke1: Uint8Array;
  }): Promise<{ ke2: Uint8Array; loginState: OpaqueLoginState }> {
    const { mod, server, cfg } = await this.getReady();
    const record = mod.RegistrationRecord.deserialize(cfg, Array.from(input.registrationRecord));
    const ke1 = mod.KE1.deserialize(cfg, Array.from(input.ke1));

    const result = await server.authInit(ke1, record, input.credentialIdentifier);
    if (result instanceof Error) throw result;

    return {
      ke2: Uint8Array.from(result.ke2.serialize()),
      loginState: {
        credentialIdentifier: input.credentialIdentifier,
        // See the OpaqueLoginState comment in opaque-server-provider.ts:
        // this is the serialized ExpectedAuthResult, not "a sessionKey".
        opaqueState: Uint8Array.from(result.expected.serialize()),
      },
    };
  }

  async finishLogin(input: {
    loginState: OpaqueLoginState;
    ke3: Uint8Array;
  }): Promise<{ sessionKey: Uint8Array }> {
    const { mod, server, cfg } = await this.getReady();
    const expected = mod.ExpectedAuthResult.deserialize(cfg, Array.from(input.loginState.opaqueState));
    const ke3 = mod.KE3.deserialize(cfg, Array.from(input.ke3));

    // authFinish is NOT async in the real API -- unlike everything else.
    const result = server.authFinish(ke3, expected);
    if (result instanceof Error) throw result;

    return { sessionKey: Uint8Array.from(result.session_key) };
  }

  async isValidRegistrationRecord(registrationRecord: Uint8Array): Promise<boolean> {
    const { mod, cfg } = await this.getReady();
    try {
      // Same call createLoginResponse already makes on this same bytes
      // shape (see above) -- deserialize throws (not "returns Error",
      // unlike the other opaque-ts calls in this file) on malformed
      // input, e.g. "Error: error deserializing element" from
      // voprf-ts's Group.deserialize. We only care whether it throws.
      mod.RegistrationRecord.deserialize(cfg, Array.from(registrationRecord));
      return true;
    } catch {
      return false;
    }
  }
}
