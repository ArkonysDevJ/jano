import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class RegisterStartDto {
  @IsEmail()
  email!: string;

  /** OPAQUE's registrationRequest (section 4), base64-encoded. */
  @IsString()
  @IsNotEmpty()
  registrationRequest!: string;
}
