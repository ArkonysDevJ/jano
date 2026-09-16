// Bootstraps a real OPAQUE-authenticated session against a RUNNING
// instance of apps/api, and prints the result as ready-to-paste Bruno
// environment variables.
//
// Why this exists: the API's real binding (auth.module.ts) is
// CloudflareOpaqueServerProvider, not the fake -- so a Bruno request
// can't just POST plausible-looking bytes to /auth/register/* or
// /auth/login/* and expect them to work. Those two endpoints need a
// REAL OpaqueClient doing REAL protocol math (OPRF blinding, envelope
// creation/recovery) on the "client" side first. Bruno's request/response
// model has nowhere natural to run that -- so this script does it once,
// outside Bruno, using the same @cloudflare/opaque-ts already installed
// for the server (see cloudflare-opaque-server-provider.spec.ts, which
// drives the identical client-side calls in-process for its own test).
//
// Once you have a sessionToken/refreshToken from this script, every
// OTHER endpoint (vault items, vault-keys, sync) is plain JSON + a
// Bearer header -- no further OPAQUE math needed -- which is exactly
// what the bruno/ collection's requests exercise directly.
//
// UPDATE (2026-09-14): rotation is ALSO OPAQUE math (rotate/start
// calls the same createRegistrationResponse as register/start), so it
// has the same limitation -- bruno/rotation/start.bru's body is a
// placeholder for exactly this reason (see its own docs{} block). This
// script now performs a full rotate/start + rotate/finish round-trip
// too, right after login, Factor-1-only (the fixture account below
// never opts into hardened mode) -- prints the new password so you can
// keep using this account afterward.
//
// Usage (server must already be running -- `npm run start:dev
// --workspace=apps/api`, with a real .env: JWT_SECRET +
// OPAQUE_OPRF_SEED_B64/OPAQUE_AKE_*_B64 from
// generate-opaque-server-secrets.mjs):
//
//   node apps/api/scripts/opaque-bruno-fixture.mjs [email] [password] [deviceLabel]
//
// Defaults: bruno-fixture@example.com / a-test-password-not-real / bruno-fixture-device
// Override the API base with API_BASE_URL (default http://localhost:3000).
//
// IMPORTANT (updated 2026-09-15, real Postgres persistence): unlike
// the original in-memory setup, an email registered by this script now
// stays registered FOREVER (or until you reset the database), even
// across server restarts. Re-running with an email you already used --
// the default `bruno-fixture@example.com` included -- always fails
// with "Cannot complete registration" (register/start's deliberate
// duplicate-email rejection, see auth.service.ts). This is correct
// behavior, not a bug: it's the same check that protects real users
// from a second, competing registration on their address. Always pass
// a FRESH email as the first argument, e.g.:
//
//   node apps/api/scripts/opaque-bruno-fixture.mjs "test-$(date +%s)@example.com"
//
// (PowerShell equivalent: node apps/api/scripts/opaque-bruno-fixture.mjs "test-$(Get-Date -UFormat %s)@example.com")
//
// .mjs on purpose -- @cloudflare/opaque-ts is a pure ESM package, same
// reasoning as generate-opaque-server-secrets.mjs.

import * as opaque from '@cloudflare/opaque-ts';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const email = process.argv[2] ?? 'bruno-fixture@example.com';
const password = process.argv[3] ?? 'a-test-password-not-real';
const deviceLabel = process.argv[4] ?? 'bruno-fixture-device';

function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function postJson(path, body, bearerToken) {
  const headers = { 'content-type': 'application/json' };
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}: ${text}`);
  }
  return json;
}

async function main() {
  const cfg = opaque.getOpaqueConfig(opaque.OpaqueID.OPAQUE_P256);
  const client = new opaque.OpaqueClient(cfg);

  // --- Registration ---
  const registrationRequest = await client.registerInit(password);
  if (registrationRequest instanceof Error) throw registrationRequest;

  const { registrationResponse } = await postJson('/auth/register/start', {
    email,
    registrationRequest: toBase64(registrationRequest.serialize()),
  });

  const deserializedResponse = opaque.RegistrationResponse.deserialize(
    cfg,
    Array.from(Buffer.from(registrationResponse, 'base64')),
  );
  const registerResult = await client.registerFinish(deserializedResponse);
  if (registerResult instanceof Error) throw registerResult;

  const { userId } = await postJson('/auth/register/finish', {
    email,
    registrationRecord: toBase64(registerResult.record.serialize()),
  });

  // --- Login (issues the session/refresh tokens every other Bruno
  // request in this collection needs) ---
  const ke1 = await client.authInit(password);
  if (ke1 instanceof Error) throw ke1;

  const { ke2 } = await postJson('/auth/login/start', {
    email,
    ke1: toBase64(ke1.serialize()),
  });

  const deserializedKe2 = opaque.KE2.deserialize(cfg, Array.from(Buffer.from(ke2, 'base64')));
  const authFinishResult = await client.authFinish(deserializedKe2);
  if (authFinishResult instanceof Error) throw authFinishResult;

  const { sessionToken, refreshToken, deviceId } = await postJson('/auth/login/finish', {
    email,
    ke3: toBase64(authFinishResult.ke3.serialize()),
    deviceLabel,
  });

  // --- Rotation (section 13's pending_opaque_rotation re-registration,
  // Factor 1 only -- RotationAuthGuard accepts either token above, this
  // uses sessionToken). Same OPAQUE math as registration, just against
  // /auth/rotate/* instead of /auth/register/*, and authenticated. ---
  const newPassword = `${password}-rotated`;
  const rotationClient = new opaque.OpaqueClient(cfg);
  const rotRegistrationRequest = await rotationClient.registerInit(newPassword);
  if (rotRegistrationRequest instanceof Error) throw rotRegistrationRequest;

  const rotateStart = await postJson(
    '/auth/rotate/start',
    { registrationRequest: toBase64(rotRegistrationRequest.serialize()) },
    sessionToken,
  );

  if (rotateStart.continuityChallenge) {
    // This fixture account never opts into hardened mode (register/finish
    // above doesn't send continuitySecret), so this should never happen.
    // If it does, the account/server disagree with this script's
    // assumptions -- fail loudly instead of guessing a Factor 2 signature.
    throw new Error(
      'rotate/start returned a continuityChallenge, but this fixture account ' +
        'has no continuitySecret to sign it with (hardened mode). This script ' +
        'only covers Factor-1-only rotation.',
    );
  }

  const rotDeserializedResponse = opaque.RegistrationResponse.deserialize(
    cfg,
    Array.from(Buffer.from(rotateStart.registrationResponse, 'base64')),
  );
  const rotRegisterResult = await rotationClient.registerFinish(rotDeserializedResponse);
  if (rotRegisterResult instanceof Error) throw rotRegisterResult;

  const rotateFinish = await postJson(
    '/auth/rotate/finish',
    { registrationRecord: toBase64(rotRegisterResult.record.serialize()) },
    sessionToken,
  );

  console.log('# Paste these into the "local" Bruno environment (apps/api/bruno/environments/local.bru):\n');
  console.log(`userId=${userId}`);
  console.log(`deviceId=${deviceId}`);
  console.log(`sessionToken=${sessionToken}`);
  console.log(`refreshToken=${refreshToken}`);
  console.log(`\n# Registered/logged in as: ${email}`);
  console.log(`# Rotation round-trip: ${rotateFinish.rotated ? 'OK (rotated: true)' : 'UNEXPECTED response'}`);
  console.log(`# Password is now: ${newPassword} (old password no longer works -- the OPAQUE record was replaced)`);
}

main().catch((err) => {
  console.error('Fixture script failed:', err);
  process.exitCode = 1;
});
