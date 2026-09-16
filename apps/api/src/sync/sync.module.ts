import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
