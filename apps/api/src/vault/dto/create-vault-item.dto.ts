import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class CreateVaultItemDto {
  /** Output of apps/desktop's packSealed() under the current DEK, base64-encoded (sections 5, 12). */
  @IsString()
  @IsNotEmpty()
  ciphertext!: string;

  @IsInt()
  @Min(1)
  dekVersion!: number;
}
