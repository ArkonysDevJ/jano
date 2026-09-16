import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DEVICES_REPOSITORY, USERS_REPOSITORY } from '../persistence/tokens.js';
import type { DevicesRepository, UsersRepository } from '../persistence/repositories.js';
import { OPAQUE_SERVER_PROVIDER } from './opaque/opaque-server-provider.js';
import type { OpaqueLoginState, OpaqueServerProvider } from './opaque/opaque-server-provider.js';
import { TokenService } from './token.service.js';

interface PendingLogin {
  readonly userId: string;
  readonly loginState: OpaqueLoginState;
}

@Injectable()
export class AuthService {
  /**
   * State of in-progress OPAQUE logins (KE1 received, KE2 issued,
   * waiting for KE3) -- in memory, per process. Sufficient while
   * `apps/api` runs as a single instance; if scaled to multiple
   * replicas this needs to move to a shared store (Redis) before
   * production. Not blocking for this handoff, but explicitly
   * declared -- not left as a surprise for later.
   */
  private readonly pendingLogins = new Map<string, PendingLogin>();

  constructor(
    @Inject(OPAQUE_SERVER_PROVIDER) private readonly opaque: OpaqueServerProvider,
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
    @Inject(DEVICES_REPOSITORY) private readonly devices: DevicesRepository,
    private readonly tokens: TokenService,
  ) {}

  async registerStart(
    email: string,
    registrationRequest: Uint8Array,
  ): Promise<{ registrationResponse: Uint8Array }> {
    const existing = await this.users.findByEmail(email);
    if (existing) {
      // Deliberately generic message: don't confirm or deny whether the email already has an account.
      throw new UnauthorizedException('Cannot complete registration.');
    }
    return this.opaque.createRegistrationResponse({
      credentialIdentifier: email,
      registrationRequest,
    });
  }

  async registerFinish(
    email: string,
    registrationRecord: Uint8Array,
    continuitySecret?: Uint8Array,
  ): Promise<{ userId: string }> {
    // Same reasoning as RotationService.rotateFinish's 2026-09-15 guard
    // (see opaque-server-provider.ts's isValidRegistrationRecord doc):
    // nothing else here inspects registrationRecord before it becomes
    // this account's ONLY way to log in. Rejecting garbage now, before
    // the row ever exists, is strictly better than letting a confused
    // caller create an account it can never authenticate into later.
    if (!(await this.opaque.isValidRegistrationRecord(registrationRecord))) {
      throw new UnauthorizedException(
        'registrationRecord is not a well-formed OPAQUE record -- cannot complete registration.',
      );
    }

    const user = await this.users.create({
      email,
      registrationRecord,
      hardenedModeEnabled: !!continuitySecret,
      continuitySecret,
    });
    return { userId: user.id };
  }

  async loginStart(email: string, ke1: Uint8Array): Promise<{ ke2: Uint8Array }> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.registrationRecord) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const { ke2, loginState } = await this.opaque.createLoginResponse({
      credentialIdentifier: email,
      registrationRecord: user.registrationRecord,
      ke1,
    });

    this.pendingLogins.set(email, { userId: user.id, loginState });
    return { ke2 };
  }

  async loginFinish(
    email: string,
    ke3: Uint8Array,
    deviceLabel?: string,
  ): Promise<{ sessionToken: string; refreshToken: string; deviceId: string }> {
    const pending = this.pendingLogins.get(email);
    if (!pending) {
      throw new UnauthorizedException('No login is in progress for this user.');
    }
    // Consumed exactly once -- a repeated or out-of-order KE3 never reuses old state.
    this.pendingLogins.delete(email);

    await this.opaque.finishLogin({ loginState: pending.loginState, ke3 });

    const device = await this.devices.create({ userId: pending.userId, label: deviceLabel });

    const sessionToken = this.tokens.sign(
      { sub: pending.userId, deviceId: device.id, type: 'session' },
      '15m',
    );
    const refreshToken = this.tokens.sign(
      { sub: pending.userId, deviceId: device.id, type: 'refresh' },
      '30d',
    );

    return { sessionToken, refreshToken, deviceId: device.id };
  }
}
