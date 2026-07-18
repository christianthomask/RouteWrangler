import type { Role } from '@routewrangler/contracts';

export interface SeedUser {
  username: string;
  email: string;
  displayName: string;
  role: Role;
}

/**
 * Sprint 0 seed roster — one user per role, enough to demo "sign in as seeded
 * supervisor → authenticated hello with role". Extended each sprint as new
 * features need data (Definition of Done: seed covers new features).
 */
export const SEED_USERS: SeedUser[] = [
  {
    username: 'jeramehl',
    email: 'jeramehl@example.com',
    displayName: 'Jeramehl (Supervisor)',
    role: 'supervisor',
  },
  {
    username: 'admin',
    email: 'admin@example.com',
    displayName: 'System Admin',
    role: 'admin',
  },
  {
    username: 'reader1',
    email: 'reader1@example.com',
    displayName: 'Field Reader One',
    role: 'reader',
  },
];

/** Deterministic placeholder sub used only in local-only seeding (no pool). */
export function localOnlySub(username: string): string {
  return `local-only:${username}`;
}
