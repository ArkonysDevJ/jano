import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { SessionGuard, type AuthenticatedRequest } from '../auth/guards/session.guard.js';
import { VaultService } from './vault.service.js';
import { CreateVaultItemDto } from './dto/create-vault-item.dto.js';
import { UpdateVaultItemDto } from './dto/update-vault-item.dto.js';
import type { VaultItemRecord } from '../persistence/entities.js';

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function toItemResponse(item: VaultItemRecord) {
  return {
    id: item.id,
    ciphertext: Buffer.from(item.ciphertext).toString('base64'),
    dekVersion: item.dekVersion,
    itemVersion: item.itemVersion,
    updatedAt: item.updatedAt.toISOString(),
  };
}

@Controller('vault/items')
@UseGuards(SessionGuard)
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateVaultItemDto) {
    const item = await this.vault.createItem(req.auth!.userId, fromBase64(dto.ciphertext), dto.dekVersion);
    return toItemResponse(item);
  }

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const items = await this.vault.listItems(req.auth!.userId);
    return items.map(toItemResponse);
  }

  @Get(':id')
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const item = await this.vault.getItem(req.auth!.userId, id);
    return toItemResponse(item);
  }

  @Put(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateVaultItemDto,
  ) {
    const item = await this.vault.updateItem(
      req.auth!.userId,
      id,
      fromBase64(dto.ciphertext),
      dto.dekVersion,
    );
    return toItemResponse(item);
  }
}
