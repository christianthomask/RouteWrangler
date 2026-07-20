import { Module } from '@nestjs/common';
import { EnvModule } from './config/env.module';
import { DbModule } from './db/db.module';
import { StorageModule } from './storage/storage.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { TaxonomyModule } from './taxonomy/taxonomy.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { RunsModule } from './runs/runs.module';
import { PhotosModule } from './photos/photos.module';
import { ExceptionsModule } from './exceptions/exceptions.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MetersModule } from './meters/meters.module';
import { RosterModule } from './roster/roster.module';
import { CatalogModule } from './catalog/catalog.module';

@Module({
  imports: [
    EnvModule,
    DbModule,
    StorageModule,
    AuditModule,
    AuthModule,
    TaxonomyModule,
    HealthModule,
    UsersModule,
    IngestionModule,
    RunsModule,
    PhotosModule,
    ExceptionsModule,
    DashboardModule,
    MetersModule,
    RosterModule,
    CatalogModule,
  ],
})
export class AppModule {}
