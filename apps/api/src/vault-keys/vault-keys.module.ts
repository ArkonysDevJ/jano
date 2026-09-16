import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { VaultKeysController } from './vault-keys.controller.js';
import { VaultKeysService } from './vault-keys.service.js';

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [VaultKeysController],
  providers: [VaultKeysService],
})
export class VaultKeysModule {}
