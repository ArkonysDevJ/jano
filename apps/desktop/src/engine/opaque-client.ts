/**
 * Client role of the OPAQUE protocol (section 4) -- crypto only, no
 * network. Every call here mirrors, byte-for-byte, the client-side
 * calls already validated against the real server provider in
 * apps/api/src/auth/opaque/cloudflare-opaque-server-provider.spec.ts
 * (same library, same call shapes, copied from a test that's already
 * been run and confirmed on real hardware -- not a fresh guess at the
 * API surface).
 *
 * NOT verified in THIS sandbox: @cloudflare/opaque-ts needs network to
 * install (npm registry blocked here, same limitation noted in that
 * spec file's own header comment) and isn't installed in apps/desktop
 * yet either. Must be run and confirmed on a real machine before being
 * trusted -- same discipline the server-side provider went through.
 *
 * Deliberately has no knowledge of HTTP -- apps/desktop hasn't chosen
 * an HTTP layer yet (fetch vs a Tauri command). Callers own the network
 * round-trip; this module only produces/consumes the bytes that cross
 * it. See rotation-state-machine.ts's `OpaqueRotationClient` for where
 * this is meant to plug in once that choice is made.
 */

import * as opaque from '@cloudflare/opaque-ts';

const CONFIG = opaque.getOpaqueConfig(opaque.OpaqueID.OPAQUE_P256);

type Client = InstanceType<typeof opaque.OpaqueClient>;

export interface RegistrationStart {
  /** Send to POST /auth/register/start (or /auth/rotate/start) as base64. */
  readonly registrationRequest: Uint8Array;
  /** Opaque handle -- pass unchanged to `finishRegistration`. Not serializable, do not persist it. */
  readonly client: Client;
}

/** Registration, step 1 (also used for section 13's re-registration -- same protocol, different endpoint). */
export async function startRegistration(password: string): Promise<RegistrationStart> {
  const client = new opaque.OpaqueClient(CONFIG);
  const registrationRequest = await client.registerInit(password);
  if (registrationRequest instanceof Error) throw registrationRequest;
  return { registrationRequest: Uint8Array.from(registrationRequest.serialize()), client };
}

/** Registration, step 2. `registrationResponse` is what the server returned from step 1. */
export async function finishRegistration(
  client: Client,
  registrationResponse: Uint8Array,
): Promise<Uint8Array> {
  const deserialized = opaque.RegistrationResponse.deserialize(CONFIG, Array.from(registrationResponse));
  const result = await client.registerFinish(deserialized);
  if (result instanceof Error) throw result;
  // Send to POST /auth/register/finish (or /auth/rotate/finish) as base64.
  return Uint8Array.from(result.record.serialize());
}

export interface LoginStart {
  /** Send to POST /auth/login/start as base64. */
  readonly ke1: Uint8Array;
  readonly client: Client;
}

/** Login, step 1. */
export async function startLogin(password: string): Promise<LoginStart> {
  const client = new opaque.OpaqueClient(CONFIG);
  const ke1 = await client.authInit(password);
  if (ke1 instanceof Error) throw ke1;
  return { ke1: Uint8Array.from(ke1.serialize()), client };
}

/**
 * Login, step 2. `ke2` is what the server returned from step 1.
 *
 * A wrong password fails INSIDE this call, not on the server: the
 * client can't even build a valid KE3 without first recovering its
 * credential envelope, which needs the correct password (confirmed
 * against the real library, see the spec file referenced above). The
 * library's own convention is to resolve with an Error instance rather
 * than reject the promise -- normalized here into an actual thrown
 * error, so this module's callers get the more idiomatic failure shape
 * and don't each have to re-derive that quirk.
 */
export async function finishLogin(client: Client, ke2: Uint8Array): Promise<Uint8Array> {
  const deserialized = opaque.KE2.deserialize(CONFIG, Array.from(ke2));
  const result = await client.authFinish(deserialized);
  if (result instanceof Error) throw result;
  // Send to POST /auth/login/finish as base64.
  return Uint8Array.from(result.ke3.serialize());
}
