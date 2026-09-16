import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

/**
 * Direct CRUD, with no conflict detection -- that's SyncModule's
 * responsibility (section 14, conflict-fork), a separate module that
 * doesn't exist yet. This endpoint simply overwrites; using it outside
 * of Sync short-circuits the "never a silent merge" guarantee the
 * architecture requires for the real synchronization path.
 */
export class UpdateVaultItemDto {
  @IsString()
  @IsNotEmpty()
  ciphertext!: string;

  @IsInt()
  @Min(1)
  dekVersion!: number;
}
