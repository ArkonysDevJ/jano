import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { RotationService } from './rotation.service.js';
import { FakeOpaqueServerProvider } from '../auth/opaque/fake-opaque-server-provider.js';
import { InMemoryUsersRepository } from '../persistence/in-memory/in-memory-users.repository.js';
import { InMemoryDevicesRepository } from '../persistence/in-memory/in-memory-devices.repository.js';

/**
 * Uses FakeOpaqueServerProvider, same reasoning as auth.service.spec.ts:
 * this exercises RotationService's own control flow (Factor 1 is the
 * guard's job, tested separately if at all; Factor 2, idempotency,
 * NotFound handling) -- not OPAQUE's cryptography.
 */
describe('RotationService', () => {
  let users: InMemoryUsersRepository;
  let service: RotationService;
  const deviceId = 'device-1';

  beforeEach(() => {
    users = new InMemoryUsersRepository();
    service = new RotationService(new FakeOpaqueServerProvider(), users, new InMemoryDevicesRepository());
  });

  it('rotates the registration_record for an account without hardened mode (Factor 1 only)', async () => {
    const user = await users.create({ email: 'a@example.com', registrationRecord: new TextEncoder().encode('old') });

    const { registrationResponse, continuityChallenge } = await service.rotateStart(
      user.id,
      deviceId,
      new TextEncoder().encode('new-req'),
    );
    expect(registrationResponse).toEqual(new TextEncoder().encode('new-req')); // Fake echoes it back
    expect(continuityChallenge).toBeUndefined();

    const result = await service.rotateFinish(user.id, deviceId, new TextEncoder().encode('new-record'));
    expect(result.rotated).toBe(true);

    const updated = await users.findById(user.id);
    expect(new TextDecoder().decode(updated!.registrationRecord!)).toBe('new-record');
  });

  it('is idempotent: finishing again with the SAME already-applied record succeeds without a fresh challenge', async () => {
    const user = await users.create({ email: 'b@example.com', registrationRecord: new TextEncoder().encode('old') });
    await service.rotateStart(user.id, deviceId, new TextEncoder().encode('req'));
    await service.rotateFinish(user.id, deviceId, new TextEncoder().encode('applied-record'));

    // Retried, e.g. because the client never saw the first response --
    // no rotateStart call precedes this one, so no challenge exists.
    const result = await service.rotateFinish(user.id, deviceId, new TextEncoder().encode('applied-record'));
    expect(result.rotated).toBe(true);
  });

  it('requires a valid continuity signature (Factor 2) when hardened mode is enabled', async () => {
    const continuitySecret = new TextEncoder().encode('shared-secret');
    const user = await users.create({
      email: 'c@example.com',
      registrationRecord: new TextEncoder().encode('old'),
      hardenedModeEnabled: true,
      continuitySecret,
    });

    const { continuityChallenge } = await service.rotateStart(user.id, deviceId, new TextEncoder().encode('req'));
    expect(continuityChallenge).toBeInstanceOf(Uint8Array);

    const validSignature = createHmac('sha256', continuitySecret).update(continuityChallenge!).digest();
    const result = await service.rotateFinish(
      user.id,
      deviceId,
      new TextEncoder().encode('new-record'),
      validSignature,
    );
    expect(result.rotated).toBe(true);
  });

  it('rejects a wrong continuity signature (Factor 2 failure) without mutating anything', async () => {
    const continuitySecret = new TextEncoder().encode('shared-secret');
    const user = await users.create({
      email: 'd@example.com',
      registrationRecord: new TextEncoder().encode('old'),
      hardenedModeEnabled: true,
      continuitySecret,
    });

    await service.rotateStart(user.id, deviceId, new TextEncoder().encode('req'));
    const wrongSignature = createHmac('sha256', new TextEncoder().encode('not-the-secret'))
      .update(new TextEncoder().encode('irrelevant'))
      .digest();

    await expect(
      service.rotateFinish(user.id, deviceId, new TextEncoder().encode('new-record'), wrongSignature),
    ).rejects.toThrow();

    const unchanged = await users.findById(user.id);
    expect(new TextDecoder().decode(unchanged!.registrationRecord!)).toBe('old');
  });

  it('rejects finish for a hardened account with no prior rotate/start (no pending challenge)', async () => {
    const user = await users.create({
      email: 'e@example.com',
      registrationRecord: new TextEncoder().encode('old'),
      hardenedModeEnabled: true,
      continuitySecret: new TextEncoder().encode('secret'),
    });

    await expect(
      service.rotateFinish(user.id, deviceId, new TextEncoder().encode('new-record'), new Uint8Array([1, 2, 3])),
    ).rejects.toThrow();
  });

  /**
   * Guards the 2026-09-15 fix: a valid Factor-1 token alone used to be
   * enough to overwrite registration_record with ANY bytes, including
   * garbage that isn't a real OPAQUE record -- this happened in
   * practice (a Bruno request run with its placeholder body left in).
   * FakeOpaqueServerProvider.isValidRegistrationRecord only rejects
   * empty bytes (see its own comment), so that's the boundary exercised
   * here -- CloudflareOpaqueServerProvider's real deserialization
   * attempt is what actually validates OPAQUE-ness in production.
   */
  it('rejects a structurally invalid registrationRecord instead of silently accepting it (Factor 1)', async () => {
    const user = await users.create({ email: 'f@example.com', registrationRecord: new TextEncoder().encode('old') });

    await expect(service.rotateFinish(user.id, deviceId, new Uint8Array(0))).rejects.toThrow();

    const unchanged = await users.findById(user.id);
    expect(new TextDecoder().decode(unchanged!.registrationRecord!)).toBe('old');
  });

  it('throws NotFoundException from rotateStart and rotateFinish for a nonexistent user', async () => {
    await expect(service.rotateStart('nobody', deviceId, new TextEncoder().encode('req'))).rejects.toThrow();
    await expect(
      service.rotateFinish('nobody', deviceId, new TextEncoder().encode('record')),
    ).rejects.toThrow();
  });
});
