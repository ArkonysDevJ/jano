import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { SessionGuard, type AuthenticatedRequest } from '../auth/guards/session.guard.js';
import { VaultKeysService } from './vault-keys.service.js';
import { UpsertVaultKeyDto } from './dto/upsert-vault-key.dto.js';
import type { VaultKeyRecord } from '../persistence/entities.js';

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function toKeyResponse(key: VaultKeyRecord) {
  return {
    purpose: key.purpose,
    wrappedDek: Buffer.from(key.wrappedDek).toString('base64'),
    keyVersion: key.keyVersion,
    updatedAt: key.updatedAt.toISOString(),
  };
}

@Controller('vault-keys')
@UseGuards(SessionGuard)
export class VaultKeysController {
  constructor(private readonly vaultKeys: VaultKeysService) {}

  @Post()
  async upsert(@Req() req: AuthenticatedRequest, @Body() dto: UpsertVaultKeyDto) {
    const key = await this.vaultKeys.upsert(
      req.auth!.userId,
      dto.purpose,
      fromBase64(dto.wrappedDek),
      dto.keyVersion,
    );
    return toKeyResponse(key);
  }

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const keys = await this.vaultKeys.list(req.auth!.userId);
    return keys.map(toKeyResponse);
  }
}
