import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RotateFinishDto {
  /** New OPAQUE registrationRecord, base64-encoded (same shape as register/finish). */
  @IsString()
  @IsNotEmpty()
  registrationRecord!: string;

  /**
   * Factor 2 -- required only if the account has hardened mode enabled
   * (see rotation.service.ts). HMAC-SHA256 of the continuityChallenge
   * returned by rotate/start, keyed by the client's continuitySecret,
   * base64-encoded.
   */
  @IsOptional()
  @IsString()
  continuitySignature?: string;
}
