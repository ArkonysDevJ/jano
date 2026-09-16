import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RateLimitGuard } from '../auth/rate-limit/rate-limit.guard.js';
import { RotationController } from './rotation.controller.js';
import { RotationService } from './rotation.service.js';

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [RotationController],
  // RateLimitGuard gets its own instance (and rate-limit store) here,
  // separate from the one AuthController uses -- each module throttles
  // its own endpoints independently, which is the right granularity
  // (a burst against /auth/login shouldn't spend the /auth/rotate/*
  // budget or vice versa).
  providers: [RotationService, RateLimitGuard],
})
export class RotationModule {}
