import { IsNotEmpty, IsString } from 'class-validator';

export class RotateStartDto {
  /** New OPAQUE registrationRequest, base64-encoded (same shape as register/start). */
  @IsString()
  @IsNotEmpty()
  registrationRequest!: string;
}
