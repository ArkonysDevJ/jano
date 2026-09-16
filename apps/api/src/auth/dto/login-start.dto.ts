import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginStartDto {
  @IsEmail()
  email!: string;

  /** KE1 of the OPAQUE handshake (section 4), base64-encoded. */
  @IsString()
  @IsNotEmpty()
  ke1!: string;
}
