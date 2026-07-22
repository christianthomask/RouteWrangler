import { Module } from '@nestjs/common';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import { StaffController } from './staff.controller';
import { DevUsersController } from './dev-users.controller';
import { StaffService } from './staff.service';
import { LocalStaffDirectory } from './local-staff-directory';
import { ClerkStaffDirectory } from './clerk-staff-directory';
import { STAFF_DIRECTORY, type StaffDirectoryPort } from './staff-directory.port';

/**
 * Staff administration. The directory adapter is chosen once at boot from the
 * resolved env — provider by config, not by code (ADR-015, ADR-024).
 */
@Module({
  controllers: [StaffController, DevUsersController],
  providers: [
    StaffService,
    {
      provide: STAFF_DIRECTORY,
      inject: [ENV],
      useFactory: (env: Env): StaffDirectoryPort =>
        env.staffProvider === 'clerk'
          ? // Both are guaranteed present — `staffProvider` only resolves to
            // 'clerk' when they are (see loadEnv).
            new ClerkStaffDirectory(env.CLERK_SECRET_KEY as string, env.CLERK_ORGANIZATION_ID as string)
          : new LocalStaffDirectory(),
    },
  ],
})
export class StaffModule {}
