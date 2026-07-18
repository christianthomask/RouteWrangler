import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { verifierProvider } from './verifier.provider';

/**
 * Wires auth globally: every route is JWT-guarded then role-guarded unless it
 * opts out via @Public(). Guard order follows registration order.
 */
@Module({
  providers: [
    verifierProvider,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
