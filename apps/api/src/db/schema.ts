import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Sprint 0 schema — the walking skeleton only needs `users` to prove real auth
 * (BUILD_SPEC §5, §6). The full schema (clients, meters, routes, read_events,
 * exceptions, …) lands in Sprint 1. Roles map 1:1 to Cognito groups (ADR-004).
 */
export const roleEnum = pgEnum('role', ['reader', 'supervisor', 'admin']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  cognitoSub: text('cognito_sub').notNull().unique(),
  displayName: text('display_name').notNull(),
  role: roleEnum('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
