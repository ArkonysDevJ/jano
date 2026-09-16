import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterStartDto } from './dto/register-start.dto.js';
import { RegisterFinishDto } from './dto/register-finish.dto.js';
import { LoginStartDto } from './dto/login-start.dto.js';
import { LoginFinishDto } from './dto/login-finish.dto.js';
import { RateLimit } from './rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from './rate-limit/rate-limit.guard.js';

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Rate limiting (section 8, MUST-HAVE): OPAQUE is CPU-intensive -- these
 * four endpoints are exactly the target section 8 asks to protect.
 * RateLimitGuard reads the limit from @RateLimit per handler (see
 * rate-limit.guard.ts).
 */
@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register/start')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  @HttpCode(200)
  async registerStart(@Body() dto: RegisterStartDto) {
    const { registrationResponse } = await this.auth.registerStart(
      dto.email,
      fromBase64(dto.registrationRequest),
    );
    return { registrationResponse: toBase64(registrationResponse) };
  }

  @Post('register/finish')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  @HttpCode(201)
  async registerFinish(@Body() dto: RegisterFinishDto) {
    return this.auth.registerFinish(
      dto.email,
      fromBase64(dto.registrationRecord),
      dto.continuitySecret ? fromBase64(dto.continuitySecret) : undefined,
    );
  }

  @Post('login/start')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @HttpCode(200)
  async loginStart(@Body() dto: LoginStartDto) {
    const { ke2 } = await this.auth.loginStart(dto.email, fromBase64(dto.ke1));
    return { ke2: toBase64(ke2) };
  }

  @Post('login/finish')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @HttpCode(200)
  async loginFinish(@Body() dto: LoginFinishDto) {
    return this.auth.loginFinish(dto.email, fromBase64(dto.ke3), dto.deviceLabel);
  }
}
