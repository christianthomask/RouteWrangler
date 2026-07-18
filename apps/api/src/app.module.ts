import { Module } from '@nestjs/common';
import { EnvModule } from './config/env.module';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { TaxonomyModule } from './taxonomy/taxonomy.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { RunsModule } from './runs/runs.module';
import { PhotosModule } from './photos/photos.module';

@Module({
  imports: [
    EnvModule,
    DbModule,
    AuthModule,
    TaxonomyModule,
    HealthModule,
    UsersModule,
    IngestionModule,
    RunsModule,
    PhotosModule,
  ],
})
export class AppModule {}
