/**
 * Server role of the OPAQUE protocol (section 4) -- deliberately
 * abstracted behind this interface. AuthService only knows this
 * interface -- swapping implementation is a single binding in
 * auth.module.ts, not a rewrite.
 *
 * - FakeOpaqueServerProvider: NOT cryptographic, only satisfies the
 *   interface's shape. For unit tests and to be able to run the API in
 *   development.
 * - CloudflareOpaqueServerProvider: real implementation against
 *   @cloudflare/opaque-ts@0.7.5 (2026-09-11, read from its .d.ts files
 *   installed via device_stage_files -- not fabricated from memory).
 *   See that file for the real API details that corrected this
 *   interface's original design, in particular: `oprf_seed` is NOT a
 *   per-user secret, it is a single secret for the whole server
 *   deployment (see docs/schema.sql).
 */

/**
 * State the server must remember between KE1 (loginStart) and KE3
 * (loginFinish). The name is deliberately generic -- it is NOT "the
 * sessionKey" itself: in the real implementation it's the serialized
 * `ExpectedAuthResult` (needed to verify the client's MAC in KE3), not
 * an already-derived session secret. See CloudflareOpaqueServerProvider.
 */
export interface OpaqueLoginState {
  readonly credentialIdentifier: string;
  readonly opaqueState: Uint8Array;
}

export interface OpaqueServerProvider {
  /**
   * Registration, step 1: the client sends a registrationRequest (an
   * OPRF blind over the raw password, never the password itself --
   * section 4). The server evaluates the OPRF by deriving that
   * identity's key from the server's global `oprf_seed` (there is no
   * per-user secret in this call) and responds. There is no password
   * or password derivative anywhere in this call.
   */
  createRegistrationResponse(input: {
    credentialIdentifier: string;
    registrationRequest: Uint8Array;
  }): Promise<{ registrationResponse: Uint8Array }>;

  /**
   * Login, step 1: the client sends KE1 (credential request + AKE
   * message). The server responds with KE2 using the
   * registrationRecord stored during registration (sections 4, 13) and
   * saves the intermediate state it will need to verify KE3.
   */
  createLoginResponse(input: {
    credentialIdentifier: string;
    registrationRecord: Uint8Array;
    ke1: Uint8Array;
  }): Promise<{ ke2: Uint8Array; loginState: OpaqueLoginState }>;

  /**
   * Login, step 2: the client confirms with KE3. If it validates, the
   * AKE handshake concludes and both sides share a sessionKey -- here
   * we use it only as proof that the handshake closed correctly before
   * issuing the session/refresh token (see TokenService); OPAQUE's
   * sessionKey itself is neither the DEK nor any vault key.
   */
  finishLogin(input: {
    loginState: OpaqueLoginState;
    ke3: Uint8Array;
  }): Promise<{ sessionKey: Uint8Array }>;

  /**
   * Structural check ONLY: does `registrationRecord` deserialize as a
   * well-formed OPAQUE record for this server's configuration?
   * Verifies nothing about identity or authorization -- no
   * credentialIdentifier, no signature, no session. Added 2026-09-15
   * for `rotation.service.ts`'s rotateFinish(): a valid session/refresh
   * token (Factor 1) proves WHO is calling, not that the bytes they
   * sent are usable OPAQUE material. Without this check, a confused or
   * mistaken caller (e.g. a Bruno request run with its placeholder body
   * left in, as happened in practice) can silently overwrite its own
   * account's real registration_record with garbage, locking itself out
   * of future logins with no error at the time it happens.
   */
  isValidRegistrationRecord(registrationRecord: Uint8Array): Promise<boolean>;
}

export const OPAQUE_SERVER_PROVIDER = Symbol('OPAQUE_SERVER_PROVIDER');
