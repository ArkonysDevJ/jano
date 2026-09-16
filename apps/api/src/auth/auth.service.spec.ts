import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service.js';
import { FakeOpaqueServerProvider } from './opaque/fake-opaque-server-provider.js';
import { TokenService } from './token.service.js';
import { InMemoryUsersRepository } from '../persistence/in-memory/in-memory-users.repository.js';
import { InMemoryDevicesRepository } from '../persistence/in-memory/in-memory-devices.repository.js';

/**
 * AuthService unit tests: we construct the classes directly with `new`,
 * without going through Nest's DI container. Two reasons:
 *
 * 1. This is what a real unit test should do -- it isolates the class's
 *    logic from Nest's infrastructure.
 * 2. Vitest uses esbuild by default, which does NOT emit `design:type`
 *    metadata for `emitDecoratorMetadata` -- Nest's
 *    Test.createTestingModule() relies on that metadata for automatic
 *    injection by type. Avoiding the DI container in tests sidesteps
 *    that problem entirely, instead of patching it with a different
 *    transform.
 *
 * These tests exercise the control flow (register -> login -> tokens),
 * NOT OPAQUE's cryptography -- they deliberately use
 * FakeOpaqueServerProvider (see that file).
 */
describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
    service = new AuthService(
      new FakeOpaqueServerProvider(),
      new InMemoryUsersRepository(),
      new InMemoryDevicesRepository(),
      new TokenService(),
    );
  });

  it('completes registration and login, and issues session + refresh token', async () => {
    const email = 'ana@example.com';
    const registrationRequest = new TextEncoder().encode('simulated-req');

    const { registrationResponse } = await service.registerStart(email, registrationRequest);
    expect(registrationResponse).toEqual(registrationRequest); // the Fake echoes it back

    const registrationRecord = new TextEncoder().encode('simulated-record');
    const { userId } = await service.registerFinish(email, registrationRecord);
    expect(userId).toBeTruthy();

    const { ke2 } = await service.loginStart(email, new TextEncoder().encode('simulated-ke1'));
    expect(ke2).toBeInstanceOf(Uint8Array);

    const result = await service.loginFinish(
      email,
      new TextEncoder().encode('simulated-ke3'),
      'test-laptop',
    );

    expect(result.sessionToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.deviceId).toBeTruthy();
  });

  it('rejects a registerStart if the email already has an account, with a generic message', async () => {
    const email = 'dup@example.com';
    const req = new TextEncoder().encode('req');
    await service.registerStart(email, req);
    await service.registerFinish(email, new TextEncoder().encode('rec'));

    await expect(service.registerStart(email, req)).rejects.toThrow();
  });

  it('rejects loginStart if the user does not exist', async () => {
    await expect(
      service.loginStart('nobody@example.com', new TextEncoder().encode('ke1')),
    ).rejects.toThrow();
  });

  it('rejects loginFinish without a prior loginStart for that email', async () => {
    await expect(
      service.loginFinish('nobody@example.com', new TextEncoder().encode('ke3')),
    ).rejects.toThrow();
  });

  it('rejects a repeated KE3 for the same, already-consumed login (does not reuse state)', async () => {
    const email = 'once@example.com';
    await service.registerStart(email, new TextEncoder().encode('req'));
    await service.registerFinish(email, new TextEncoder().encode('rec'));
    await service.loginStart(email, new TextEncoder().encode('ke1'));

    await service.loginFinish(email, new TextEncoder().encode('ke3'));
    await expect(service.loginFinish(email, new TextEncoder().encode('ke3-again'))).rejects.toThrow();
  });

  /**
   * Mirrors rotation.service.spec.ts's guard test: registerFinish must
   * not create an account whose registrationRecord isn't structurally
   * valid OPAQUE material -- FakeOpaqueServerProvider.isValidRegistrationRecord
   * only rejects empty bytes (see that file's own comment), so that's
   * the boundary exercised here.
   */
  it('rejects a structurally invalid registrationRecord instead of creating the account', async () => {
    const email = 'invalid-record@example.com';
    await service.registerStart(email, new TextEncoder().encode('req'));

    await expect(service.registerFinish(email, new Uint8Array(0))).rejects.toThrow();

    await expect(
      service.loginStart(email, new TextEncoder().encode('ke1')),
    ).rejects.toThrow(); // confirms no account was created
  });
});
