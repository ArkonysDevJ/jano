import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginFinishDto {
  @IsEmail()
  email!: string;

  /** KE3 of the OPAQUE handshake (section 4), base64-encoded. */
  @IsString()
  @IsNotEmpty()
  ke3!: string;

  @IsOptional()
  @IsString()
  deviceLabel?: string;
}
