import { IsIn, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import type { VaultKeyPurpose } from '../../persistence/entities.js';

const VAULT_KEY_PURPOSES: readonly VaultKeyPurpose[] = ['master', 'recovery'];

/**
 * Registers or replaces one of the vault's two DEK wrappings (section 3:
 * the DEK is wrapped once under the master-password KEK and once under
 * the recovery-kit KEK -- independent `key_version` per purpose). The
 * server only ever sees `wrappedDek` -- the output of the client's
 * aes-gcm.ts packSealed() -- never the KEK or the plaintext DEK.
 */
export class UpsertVaultKeyDto {
  @IsIn(VAULT_KEY_PURPOSES)
  purpose!: VaultKeyPurpose;

  @IsString()
  @IsNotEmpty()
  wrappedDek!: string;

  @IsInt()
  @Min(1)
  keyVersion!: number;
}
