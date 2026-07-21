import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  doublePrecision,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Full schema (BUILD_SPEC §5). Conventions: UUID PKs; created_at/updated_at
 * where it matters; FKs enforced; soft status enums via lookup tables where
 * taxonomy-as-data applies (ADR-003). Read events are immutable (ADR-002) — no
 * updated_at, no update path anywhere in the code.
 */

// ── enums that are role/status, not taxonomy ────────────────────────────────
export const roleEnum = pgEnum('role', ['reader', 'supervisor', 'admin']);
export const sourceTypeEnum = pgEnum('source_type', ['manual', 'touch', 'radio', 'simulated']);
export const runStatusEnum = pgEnum('run_status', ['open', 'closed']);
export const runStopStatusEnum = pgEnum('run_stop_status', ['pending', 'read', 'skipped']);
export const meterStatusEnum = pgEnum('meter_status', ['active', 'inactive']);
export const exceptionStatusEnum = pgEnum('exception_status', [
  'open',
  'reread_ordered',
  'reread_received',
  'resolved',
  'overridden',
  'escalated',
]);
export const rereadTaskStatusEnum = pgEnum('reread_task_status', ['issued', 'delivered', 'done']);

// ── users ───────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  cognitoSub: text('cognito_sub').notNull().unique(),
  displayName: text('display_name').notNull(),
  role: roleEnum('role').notNull(),
  /**
   * Soft-deactivation. `users.id` is FK-referenced by runs, exceptions and
   * audit rows without cascade, so a departed staff member with history cannot
   * be hard-deleted. Deactivating revokes access while preserving that history;
   * the auth guard refuses inactive rows.
   */
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── clients (city utility clients — first-class, ADR/§2.4) ───────────────────
export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  state: text('state').notNull(),
  cycleLengthDays: integer('cycle_length_days').notNull().default(30),
  cycleAnchorDay: integer('cycle_anchor_day').notNull().default(1),
  exportProfile: jsonb('export_profile').notNull().default({ format: 'csv' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── meters ───────────────────────────────────────────────────────────────────
export const meters = pgTable(
  'meters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    serial: text('serial').notNull(),
    serviceAddress: text('service_address').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    registerDials: integer('register_dials').notNull().default(5),
    utilityType: text('utility_type').notNull().default('water'),
    status: meterStatusEnum('status').notNull().default('active'),
    accessNotes: text('access_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Serial is the billing key — it must be unique within a client (M7).
    unique('meters_client_serial_uq').on(t.clientId, t.serial),
    index('meters_client_idx').on(t.clientId),
  ],
);

// ── routes + route_stops ─────────────────────────────────────────────────────
export const routes = pgTable('routes', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const routeStops = pgTable(
  'route_stops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id),
    meterId: uuid('meter_id')
      .notNull()
      .references(() => meters.id),
    sequence: integer('sequence').notNull(),
  },
  (t) => [unique('route_stops_route_seq_uq').on(t.routeId, t.sequence)],
);

// ── route_runs (dated instance) + run_stops ──────────────────────────────────
export const routeRuns = pgTable(
  'route_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    readerId: uuid('reader_id').references(() => users.id),
    runDate: text('run_date').notNull(), // ISO date (yyyy-mm-dd)
    cycleId: text('cycle_id').notNull(),
    status: runStatusEnum('status').notNull().default('open'),
    // Self-reference: the run this one was carved out of (ADR-005).
    splitFromRunId: uuid('split_from_run_id').references((): AnyPgColumn => routeRuns.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Export + cycle queries filter by client+cycle (H7).
    index('route_runs_client_cycle_idx').on(t.clientId, t.cycleId),
  ],
);

export const runStops = pgTable(
  'run_stops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => routeRuns.id),
    meterId: uuid('meter_id')
      .notNull()
      .references(() => meters.id),
    sequence: integer('sequence').notNull(),
    status: runStopStatusEnum('status').notNull().default('pending'),
    skipReasonId: uuid('skip_reason_id').references(() => skipReasons.id),
    completedReadEventId: uuid('completed_read_event_id').references(
      (): AnyPgColumn => readEvents.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A meter appears once per run, and sequence is unique within a run (M7).
    unique('run_stops_run_meter_uq').on(t.runId, t.meterId),
    unique('run_stops_run_seq_uq').on(t.runId, t.sequence),
    index('run_stops_run_idx').on(t.runId),
  ],
);

// ── read_events (IMMUTABLE — ADR-002) ────────────────────────────────────────
export const readEvents = pgTable(
  'read_events',
  {
    // client-generated UUIDv4 — the idempotency key (ADR-008)
    id: uuid('id').primaryKey(),
    meterId: uuid('meter_id')
      .notNull()
      .references(() => meters.id),
    runStopId: uuid('run_stop_id').references(() => runStops.id),
    readerId: uuid('reader_id')
      .notNull()
      .references(() => users.id),
    value: doublePrecision('value').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    sourceType: sourceTypeEnum('source_type').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    photoKey: text('photo_key'),
    // Reader's free-text note, captured with the read. Immutable like the rest of
    // the event (ADR-002) — set at insert, never updated.
    note: text('note'),
    annotations: jsonb('annotations').notNull().default({}),
    /** consumption computed at ingest (value − prior), for history/baseline. */
    consumption: doublePrecision('consumption'),
    billable: boolean('billable').notNull().default(false),
    exceptionId: uuid('exception_id').references((): AnyPgColumn => exceptions.id, {
      onDelete: 'set null',
    }),
    // NOTE: no updated_at — read events are never updated.
  },
  (t) => [
    // Baseline window scan is by meter + capture time; the run-detail latest
    // value scans by received time. read_events grows unbounded (H7).
    index('read_events_meter_captured_idx').on(t.meterId, t.capturedAt),
    index('read_events_meter_received_idx').on(t.meterId, t.receivedAt.desc()),
    index('read_events_run_stop_idx').on(t.runStopId),
  ],
);

// ── taxonomy lookup tables (ADR-003) ─────────────────────────────────────────
export const severities = pgTable('severities', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  rank: integer('rank').notNull(),
});

export const exceptionTypes = pgTable('exception_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  defaultSeverityId: uuid('default_severity_id')
    .notNull()
    .references(() => severities.id),
  blocksBilling: boolean('blocks_billing').notNull().default(true),
});

export const skipReasons = pgTable('skip_reasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
});

// ── exceptions ───────────────────────────────────────────────────────────────
export const exceptions = pgTable(
  'exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    readEventId: uuid('read_event_id')
      .notNull()
      .references(() => readEvents.id),
    meterId: uuid('meter_id')
      .notNull()
      .references(() => meters.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    typeId: uuid('type_id')
      .notNull()
      .references(() => exceptionTypes.id),
    severityId: uuid('severity_id')
      .notNull()
      .references(() => severities.id),
    status: exceptionStatusEnum('status').notNull().default('open'),
    rereadCount: integer('reread_count').notNull().default(0),
    actionedBy: uuid('actioned_by').references(() => users.id),
    resolutionNote: text('resolution_note'),
    // The read the supervisor certified as billable at resolution. Recorded here
    // (not by mutating the immutable read — ADR-002) so export can compute final
    // billability from the certification decision (W4).
    certifiedReadEventId: uuid('certified_read_event_id').references(
      (): AnyPgColumn => readEvents.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Export gathers a read's exceptions by read_event_id; console lists by meter (H7).
    index('exceptions_read_event_idx').on(t.readEventId),
    index('exceptions_meter_idx').on(t.meterId),
  ],
);

// ── reread_tasks ─────────────────────────────────────────────────────────────
export const rereadTasks = pgTable('reread_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  exceptionId: uuid('exception_id')
    .notNull()
    .references(() => exceptions.id),
  readerId: uuid('reader_id')
    .notNull()
    .references(() => users.id),
  status: rereadTaskStatusEnum('status').notNull().default('issued'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── export_runs ──────────────────────────────────────────────────────────────
export const exportRuns = pgTable(
  'export_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    cycleId: text('cycle_id').notNull(),
    ranBy: uuid('ran_by')
      .notNull()
      .references(() => users.id),
    counts: jsonb('counts').notNull().default({}),
    ackNote: text('ack_note'),
    format: text('format').notNull().default('csv'),
    filename: text('filename'),
    // The rendered export is an immutable snapshot of what was sent to the client's
    // billing system, kept in-row for audit and re-download (fileKey stays for a
    // future object-storage offload of large bodies — ADR-023).
    body: text('body'),
    fileKey: text('file_key'),
    // Self-reference: the export run that replaced this one (ADR-023).
    supersededByRunId: uuid('superseded_by_run_id').references(
      (): AnyPgColumn => exportRuns.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most ONE current (non-superseded) export per client+cycle — the DB-level
    // guarantee behind the supersede transaction, so two concurrent "Generate"
    // clicks can't both stay current (H4).
    uniqueIndex('export_runs_current_uq')
      .on(t.clientId, t.cycleId)
      .where(sql`${t.supersededByRunId} is null`),
    index('export_runs_client_cycle_idx').on(t.clientId, t.cycleId),
  ],
);

// ── audit_log ────────────────────────────────────────────────────────────────
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: uuid('entity_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  meta: jsonb('meta').notNull().default({}),
});

// ── relations (query ergonomics) ─────────────────────────────────────────────
export const metersRelations = relations(meters, ({ one, many }) => ({
  client: one(clients, { fields: [meters.clientId], references: [clients.id] }),
  readEvents: many(readEvents),
}));

export const readEventsRelations = relations(readEvents, ({ one }) => ({
  meter: one(meters, { fields: [readEvents.meterId], references: [meters.id] }),
  runStop: one(runStops, { fields: [readEvents.runStopId], references: [runStops.id] }),
}));

export const routeRunsRelations = relations(routeRuns, ({ one, many }) => ({
  route: one(routes, { fields: [routeRuns.routeId], references: [routes.id] }),
  client: one(clients, { fields: [routeRuns.clientId], references: [clients.id] }),
  reader: one(users, { fields: [routeRuns.readerId], references: [users.id] }),
  stops: many(runStops),
}));

export const runStopsRelations = relations(runStops, ({ one }) => ({
  run: one(routeRuns, { fields: [runStops.runId], references: [routeRuns.id] }),
  meter: one(meters, { fields: [runStops.meterId], references: [meters.id] }),
}));

// ── inferred row types ───────────────────────────────────────────────────────
export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type ClientRow = typeof clients.$inferSelect;
export type MeterRow = typeof meters.$inferSelect;
export type RouteRow = typeof routes.$inferSelect;
export type RouteRunRow = typeof routeRuns.$inferSelect;
export type RunStopRow = typeof runStops.$inferSelect;
export type ReadEventRow = typeof readEvents.$inferSelect;
export type NewReadEventRow = typeof readEvents.$inferInsert;
export type ExceptionRow = typeof exceptions.$inferSelect;
export type NewExceptionRow = typeof exceptions.$inferInsert;
