import type { OpaqueLoginState, OpaqueServerProvider } from './opaque-server-provider.js';

/**
 * NON-CRYPTOGRAPHIC fake of OpaqueServerProvider. "Echoes" back what it
 * receives and generates random secrets where real OPAQUE would derive
 * a sessionKey -- it offers NONE of the protocol's guarantees (no
 * OPRF, no AKE, no dictionary-attack resistance). It exists solely
 * for:
 *
 * 1. AuthService unit tests (auth.service.spec.ts) -- they exercise the
 *    control flow (register -> login -> token issuance), not the
 *    underlying cryptography.
 * 2. Running `apps/api` in local development before
 *    CloudflareOpaqueServerProvider is verified.
 *
 * NEVER use outside tests/dev. The binding in auth.module.ts makes
 * this explicit with a comment -- do not change it without first
 * verifying the real implementation.
 */
export class FakeOpaqueServerProvider implements OpaqueServerProvider {
  async createRegistrationResponse(input: {
    credentialIdentifier: string;
    registrationRequest: Uint8Array;
  }): Promise<{ registrationResponse: Uint8Array }> {
    return { registrationResponse: input.registrationRequest };
  }

  async createLoginResponse(input: {
    credentialIdentifier: string;
    registrationRecord: Uint8Array;
    ke1: Uint8Array;
  }): Promise<{ ke2: Uint8Array; loginState: OpaqueLoginState }> {
    const loginState: OpaqueLoginState = {
      credentialIdentifier: input.credentialIdentifier,
      opaqueState: crypto.getRandomValues(new Uint8Array(32)),
    };
    return { ke2: input.ke1, loginState };
  }

  async finishLogin(input: {
    loginState: OpaqueLoginState;
    ke3: Uint8Array;
  }): Promise<{ sessionKey: Uint8Array }> {
    return { sessionKey: input.loginState.opaqueState };
  }

  /**
   * Non-cryptographic stand-in: this fake has no real OPAQUE byte
   * format to check against, so it only rejects the unambiguous
   * nothing-at-all case (empty bytes). That's enough to exercise
   * RotationService's control flow around this check in tests --
   * CloudflareOpaqueServerProvider's real deserialization attempt is
   * what actually guarantees the bytes are usable OPAQUE material.
   */
  async isValidRegistrationRecord(registrationRecord: Uint8Array): Promise<boolean> {
    return registrationRecord.length > 0;
  }
}
