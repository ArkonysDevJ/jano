import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OPAQUE_SERVER_PROVIDER } from '../auth/opaque/opaque-server-provider.js';
import type { OpaqueServerProvider } from '../auth/opaque/opaque-server-provider.js';
import { DEVICES_REPOSITORY, USERS_REPOSITORY } from '../persistence/tokens.js';
import type { DevicesRepository, UsersRepository } from '../persistence/repositories.js';

export interface RotateStartResult {
  readonly registrationResponse: Uint8Array;
  /** Present only when the account has hardened mode enabled (Factor 2). */
  readonly continuityChallenge?: Uint8Array;
}

export interface RotateFinishResult {
  readonly rotated: boolean;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Section 13's `pending_opaque_rotation` re-registration: a device that
 * rotated its master password OFFLINE re-registers its new OPAQUE
 * `registration_record` against the server on reconnection. This is a
 * two-phase, idempotent protocol per the architecture doc -- a network
 * interruption mid-process must never leave the client without a
 * pending record AND without an updated server simultaneously.
 *
 * Mandatory Factor 1 (always): a valid session OR refresh token for
 * that device -- enforced entirely by RotationAuthGuard, upstream of
 * this service. Without it, no call here ever happens.
 *
 * Optional Factor 2 ("hardened mode", opted into at registration --
 * see AuthService.registerFinish / RegisterFinishDto.continuitySecret):
 * a nonce-challenge/response over an HMAC-SHA256 secret. Deliberate
 * departure from the architecture doc's word "verifier": a true
 * verifier (an asymmetric public key, say) would let the server check
 * the proof without ever holding secret material itself. Building that
 * needs a concrete signature scheme and key encoding the client engine
 * (apps/desktop, not built yet) hasn't defined. Storing a shared HMAC
 * secret was chosen as a first pass that still gets the property that
 * actually matters here -- a fresh, server-issued, single-use nonce
 * defeats replay of a captured signature -- without blocking on that
 * unresolved client-side design. Flagged explicitly, not silently
 * downgraded: if the server itself is ever compromised, Factor 2 stops
 * adding INDEPENDENT protection beyond Factor 1's token, since both
 * live in the same store. Revisit with an asymmetric signature once the
 * client engine's crypto primitives are decided -- this is not
 * equivalent to a real second factor against a server-side breach, only
 * against a stolen token used in isolation.
 *
 * The pending challenge itself is persisted via DevicesRepository
 * (docs/schema.sql's pending_rotation_challenge columns), not an
 * in-memory Map -- it used to be, before persistence moved to a real
 * database, and a process restart between rotate/start and
 * rotate/finish would have silently stranded an in-flight hardened-mode
 * rotation.
 */
@Injectable()
export class RotationService {
  constructor(
    @Inject(OPAQUE_SERVER_PROVIDER) private readonly opaque: OpaqueServerProvider,
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
    @Inject(DEVICES_REPOSITORY) private readonly devices: DevicesRepository,
  ) {}

  async rotateStart(
    userId: string,
    deviceId: string,
    registrationRequest: Uint8Array,
  ): Promise<RotateStartResult> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const { registrationResponse } = await this.opaque.createRegistrationResponse({
      credentialIdentifier: user.email,
      registrationRequest,
    });

    if (!user.hardenedModeEnabled) {
      return { registrationResponse };
    }

    // A fresh nonce per attempt -- calling start again before finish
    // simply supersedes the previous challenge (the client always signs
    // whichever challenge it most recently received).
    const challenge = randomBytes(32);
    await this.devices.setPendingRotationChallenge(deviceId, challenge);
    return { registrationResponse, continuityChallenge: challenge };
  }

  async rotateFinish(
    userId: string,
    deviceId: string,
    registrationRecord: Uint8Array,
    continuitySignature?: Uint8Array,
  ): Promise<RotateFinishResult> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    // Idempotent replay: the mutation already landed (a prior call
    // succeeded server-side but the client never saw the response, e.g.
    // the connection dropped) -- there is nothing left to authorize, so
    // this returns success without re-checking Factor 2 or requiring a
    // challenge that may no longer exist. This is precisely the
    // "network interruption never leaves an inconsistent state" clause.
    if (user.registrationRecord && bytesEqual(user.registrationRecord, registrationRecord)) {
      return { rotated: true };
    }

    // A valid session/refresh token (Factor 1, enforced upstream by
    // RotationAuthGuard) proves WHO is calling, not that the bytes they
    // sent are actually usable OPAQUE material -- nothing else inspects
    // registrationRecord before it gets persisted below. Without this
    // check, a confused or mistaken caller silently overwrites its own
    // login credential with garbage (this happened in practice: a Bruno
    // request run with its placeholder body left in, see start.bru's
    // docs). Checked for both Factor-1-only and hardened accounts --
    // Factor 2's signature proves authorization, not byte validity.
    if (!(await this.opaque.isValidRegistrationRecord(registrationRecord))) {
      throw new UnauthorizedException(
        'registrationRecord is not a well-formed OPAQUE record -- refusing to overwrite the existing one.',
      );
    }

    if (user.hardenedModeEnabled) {
      const pending = await this.devices.getPendingRotationChallenge(deviceId);
      if (!pending) {
        throw new UnauthorizedException(
          'No pending rotation challenge for this device -- call rotate/start first.',
        );
      }
      if (!continuitySignature || !user.continuitySecret) {
        throw new UnauthorizedException('Hardened mode requires a continuity signature.');
      }
      const expected = createHmac('sha256', user.continuitySecret).update(pending).digest();
      if (!bytesEqual(expected, continuitySignature)) {
        throw new UnauthorizedException('Continuity signature does not match (Factor 2 failed).');
      }
      // Single-use: consumed only on a genuine (non-idempotent) success.
      await this.devices.clearPendingRotationChallenge(deviceId);
    }

    await this.users.replaceRegistrationRecord(userId, registrationRecord);
    return { rotated: true };
  }
}
