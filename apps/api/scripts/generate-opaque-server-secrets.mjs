// Generates, ONCE, the two lifetime secrets of the OPAQUE server: the
// global oprf_seed and the static AKE keypair (see
// cloudflare-opaque-server-provider.ts for why these are global rather
// than per user).
//
// Run manually, ONCE per environment, and store the output as
// OPAQUE_OPRF_SEED_B64 / OPAQUE_AKE_PRIVATE_KEY_B64 /
// OPAQUE_AKE_PUBLIC_KEY_B64 in the real .env (never in git, see
// .env.example). Running it again invalidates ALL existing OPAQUE
// registrations -- this is not a startup script, it's a setup script.
//
// Usage: node scripts/generate-opaque-server-secrets.mjs
//
// .mjs on purpose -- @cloudflare/opaque-ts is a pure ESM package and
// this script imports it statically, without the CJS/ESM interop
// restrictions that DO apply inside apps/api (see the large comment in
// cloudflare-opaque-server-provider.ts).

import { getOpaqueConfig, OpaqueID } from '@cloudflare/opaque-ts';
import { randomBytes } from 'node:crypto';

const cfg = getOpaqueConfig(OpaqueID.OPAQUE_P256);

// Nseed is the seed size the suite expects for the OPRF -- read from
// the config instead of assuming 32 bytes by hand.
const oprfSeed = randomBytes(cfg.constants.Nseed);

const akeKeypairExport = await cfg.ake.generateAuthKeyPair();

console.log('# Paste into the real .env (NEVER commit to git):\n');
console.log(`OPAQUE_OPRF_SEED_B64=${oprfSeed.toString('base64')}`);
console.log(`OPAQUE_AKE_PRIVATE_KEY_B64=${Buffer.from(akeKeypairExport.private_key).toString('base64')}`);
console.log(`OPAQUE_AKE_PUBLIC_KEY_B64=${Buffer.from(akeKeypairExport.public_key).toString('base64')}`);
