import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class PullQueryDto {
  /**
   * The client's active master_key_version (section 7) -- input to the
   * reconciliation gate. `@Type(() => Number)` is required here (unlike
   * the push DTO's JSON body): query string values arrive as strings,
   * and this app's global ValidationPipe (main.ts) doesn't enable
   * implicit conversion.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  masterKeyVersion!: number;
}
