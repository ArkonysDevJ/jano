import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class PushItemDto {
  /** Existing vault_items.id when updating; omitted when creating a new item. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  itemId?: string;

  /** Output of apps/desktop's packSealed() under the current DEK, base64-encoded (sections 5, 12). */
  @IsString()
  @IsNotEmpty()
  ciphertext!: string;

  @IsInt()
  @Min(1)
  dekVersion!: number;

  /**
   * The item's `_version` (WatermelonDB, section 14) as last seen by
   * this client, before its local edit. Only meaningful when `itemId`
   * is set -- it's what the conflict-fork algorithm compares against
   * the server's current itemVersion. Ignored when creating a new
   * item.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  lastSeenItemVersion?: number;

  /** The client's active master_key_version (section 7) -- input to the reconciliation gate. */
  @IsInt()
  @Min(1)
  masterKeyVersion!: number;
}
