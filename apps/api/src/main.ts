// Loads apps/api/.env into process.env -- MUST run before any other
// import that reads process.env at construction time (TokenService,
// CloudflareOpaqueServerProvider). Without this, `npm run dev:api`
// silently depended on the shell's own exported env vars instead of the
// .env file the repo already documents (see .env.example) -- a real
// gap this line closes, not a style preference. Discovered while
// walking André through actually starting the server for the first
// time (2026-09-12).
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  // whitelist: strips fields not declared in the DTOs -- explicit input
  // surface, nothing slips through to Auth/Vault without passing through
  // class-validator.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

bootstrap();
