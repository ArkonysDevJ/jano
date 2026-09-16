import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { VaultController } from './vault.controller.js';
import { VaultService } from './vault.service.js';

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [VaultController],
  providers: [VaultService],
})
export class VaultModule {}
