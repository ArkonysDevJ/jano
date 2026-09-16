import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { RotationAuthGuard } from '../auth/guards/rotation-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/guards/session.guard.js';
import { RateLimit } from '../auth/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../auth/rate-limit/rate-limit.guard.js';
import { RotationService } from './rotation.service.js';
import { RotateStartDto } from './dto/rotate-start.dto.js';
import { RotateFinishDto } from './dto/rotate-finish.dto.js';

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Section 13: `pending_opaque_rotation` re-registration. Both routes
 * require RotationAuthGuard (Factor 1, mandatory -- see that file) AND
 * RateLimitGuard (section 8) -- OPAQUE registration is exactly as
 * CPU-intensive as login, so a compromised or looping token shouldn't
 * get unlimited free re-registration attempts. Guard ORDER matters
 * here: RotationAuthGuard must run first so `request.auth.userId` is
 * populated before RateLimitGuard reads it (see rate-limit.guard.ts --
 * it keys by userId here since there's no email in these bodies).
 */
@Controller('auth/rotate')
@UseGuards(RotationAuthGuard, RateLimitGuard)
export class RotationController {
  constructor(private readonly rotation: RotationService) {}

  @Post('start')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  async start(@Req() req: AuthenticatedRequest, @Body() dto: RotateStartDto) {
    const result = await this.rotation.rotateStart(
      req.auth!.userId,
      req.auth!.deviceId,
      fromBase64(dto.registrationRequest),
    );
    return {
      registrationResponse: toBase64(result.registrationResponse),
      continuityChallenge: result.continuityChallenge ? toBase64(result.continuityChallenge) : undefined,
    };
  }

  @Post('finish')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  async finish(@Req() req: AuthenticatedRequest, @Body() dto: RotateFinishDto) {
    return this.rotation.rotateFinish(
      req.auth!.userId,
      req.auth!.deviceId,
      fromBase64(dto.registrationRecord),
      dto.continuitySignature ? fromBase64(dto.continuitySignature) : undefined,
    );
  }
}
