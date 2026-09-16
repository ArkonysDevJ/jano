import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard, type AuthenticatedRequest } from '../auth/guards/session.guard.js';
import { SyncService } from './sync.service.js';
import { PushItemDto } from './dto/push-item.dto.js';
import { PullQueryDto } from './dto/pull-query.dto.js';
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
    conflictOf: item.conflictOf,
    updatedAt: item.updatedAt.toISOString(),
  };
}

@Controller('sync')
@UseGuards(SessionGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('push')
  async push(@Req() req: AuthenticatedRequest, @Body() dto: PushItemDto) {
    const result = await this.sync.push(req.auth!.userId, req.auth!.deviceId, {
      itemId: dto.itemId,
      ciphertext: fromBase64(dto.ciphertext),
      dekVersion: dto.dekVersion,
      lastSeenItemVersion: dto.lastSeenItemVersion,
      masterKeyVersion: dto.masterKeyVersion,
    });
    return { item: toItemResponse(result.item), conflict: result.conflict };
  }

  @Get('pull')
  async pull(@Req() req: AuthenticatedRequest, @Query() query: PullQueryDto) {
    const result = await this.sync.pull(req.auth!.userId, req.auth!.deviceId, query.masterKeyVersion);
    return { items: result.items.map(toItemResponse), masterKeyVersion: result.masterKeyVersion };
  }
}
