import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RegisterFinishDto {
  @IsEmail()
  email!: string;

  /** OPAQUE record the client issues when closing registration (section 4), base64-encoded. */
  @IsString()
  @IsNotEmpty()
  registrationRecord!: string;

  /**
   * Opts into section 13's "hardened mode" (Factor 2 on future
   * `pending_opaque_rotation` re-registrations): a client-generated
   * shared secret, base64-encoded. Optional -- omit it and the account
   * stays on Factor-1-only rotation authorization. See
   * rotation/rotation.service.ts.
   */
  @IsOptional()
  @IsString()
  continuitySecret?: string;
}
