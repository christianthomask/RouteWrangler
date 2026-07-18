import { Module } from '@nestjs/common';
import { EnvModule } from './config/env.module';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [EnvModule, DbModule, AuthModule, HealthModule, UsersModule],
})
export class AppModule {}
