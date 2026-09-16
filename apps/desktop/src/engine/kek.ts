/**
 * KEK derivation -- Argon2id, offline flow.
 * Reference: docs/ARCHITECTURE-01.md, sections 3, 4.
 *
 * Mandatory domain separation (section 4): the salt used here is
 * EXCLUSIVE to the local KEK -- never the same salt/domain as the
 * input to OPAQUE. The salt itself isn't secret, but mixing domains
 * would break the guarantee that compromising OPAQUE on the server
 * gives nothing about the local vault. The call to OPAQUE (online
 * flow, section 4) doesn't live in this file -- this module is purely
 * the local KEK.
 */

import { argon2id } from 'hash-wasm';
import type { Argon2idParams, Bytes } from './types';

/**
 * Default Argon2id parameters.
 *
 * STATUS: initial proposal, technical review still PENDING. The
 * architecture (section 4) requires Argon2id for local derivation but
 * does not fix memory/iterations/parallelism -- that is explicitly an
 * "implementation detail" (section 12), not sealed architecture.
 * These values are a reasonable starting point for a high-value vault
 * (above the minimum OWASP profile), but must go through their own
 * round of technical review before being considered part of the
 * production standard.
 */
export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = {
  memoryKib: 65536, // 64 MiB
  iterations: 3,
  parallelism: 1,
  hashLengthBytes: 32, // AES-256
};

async function deriveKek(
  secret: string | Bytes,
  salt: Bytes,
  params: Argon2idParams,
): Promise<Bytes> {
  const hash = await argon2id({
    password: secret,
    salt,
    memorySize: params.memoryKib,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: params.hashLengthBytes,
    outputType: 'binary',
  });
  return new Uint8Array(hash);
}

/**
 * Derives the master KEK (offline flow, section 4) from the master
 * password + local salt persisted to disk (protected by the OS
 * keychain where available). Never depends on the network.
 */
export function deriveMasterKek(
  masterPassword: string,
  localSalt: Bytes,
  params: Argon2idParams = DEFAULT_ARGON2ID_PARAMS,
): Promise<Bytes> {
  return deriveKek(masterPassword, localSalt, params);
}

/**
 * Derives the recovery KEK (section 3) from the recovery kit secret.
 * Same algorithm, salt independent of the master KEK's salt.
 */
export function deriveRecoveryKek(
  recoverySecret: Bytes,
  recoverySalt: Bytes,
  params: Argon2idParams = DEFAULT_ARGON2ID_PARAMS,
): Promise<Bytes> {
  return deriveKek(recoverySecret, recoverySalt, params);
}
