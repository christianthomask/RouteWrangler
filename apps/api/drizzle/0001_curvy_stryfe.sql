CREATE TYPE "public"."exception_status" AS ENUM('open', 'reread_ordered', 'reread_received', 'resolved', 'overridden', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."meter_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."reread_task_status" AS ENUM('issued', 'delivered', 'done');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."run_stop_status" AS ENUM('pending', 'read', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('manual', 'touch', 'radio', 'simulated');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"cycle_length_days" integer DEFAULT 30 NOT NULL,
	"cycle_anchor_day" integer DEFAULT 1 NOT NULL,
	"export_profile" jsonb DEFAULT '{"format":"csv"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exception_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"default_severity_id" uuid NOT NULL,
	"blocks_billing" boolean DEFAULT true NOT NULL,
	CONSTRAINT "exception_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"read_event_id" uuid NOT NULL,
	"meter_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"severity_id" uuid NOT NULL,
	"status" "exception_status" DEFAULT 'open' NOT NULL,
	"reread_count" integer DEFAULT 0 NOT NULL,
	"actioned_by" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"cycle_id" text NOT NULL,
	"ran_by" uuid NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ack_note" text,
	"file_key" text,
	"superseded_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"service_address" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"register_dials" integer DEFAULT 5 NOT NULL,
	"utility_type" text DEFAULT 'water' NOT NULL,
	"status" "meter_status" DEFAULT 'active' NOT NULL,
	"access_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"meter_id" uuid NOT NULL,
	"run_stop_id" uuid,
	"reader_id" uuid NOT NULL,
	"value" double precision NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_type" "source_type" NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"photo_key" text,
	"annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consumption" double precision,
	"billable" boolean DEFAULT false NOT NULL,
	"exception_id" uuid
);
--> statement-breakpoint
CREATE TABLE "reread_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" uuid NOT NULL,
	"reader_id" uuid NOT NULL,
	"status" "reread_task_status" DEFAULT 'issued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"reader_id" uuid,
	"run_date" text NOT NULL,
	"cycle_id" text NOT NULL,
	"status" "run_status" DEFAULT 'open' NOT NULL,
	"split_from_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"meter_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	CONSTRAINT "route_stops_route_seq_uq" UNIQUE("route_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"meter_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" "run_stop_status" DEFAULT 'pending' NOT NULL,
	"skip_reason_id" uuid,
	"completed_read_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "severities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "severities_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "skip_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "skip_reasons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_types" ADD CONSTRAINT "exception_types_default_severity_id_severities_id_fk" FOREIGN KEY ("default_severity_id") REFERENCES "public"."severities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_read_event_id_read_events_id_fk" FOREIGN KEY ("read_event_id") REFERENCES "public"."read_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_type_id_exception_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."exception_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_severity_id_severities_id_fk" FOREIGN KEY ("severity_id") REFERENCES "public"."severities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_actioned_by_users_id_fk" FOREIGN KEY ("actioned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_runs" ADD CONSTRAINT "export_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_runs" ADD CONSTRAINT "export_runs_ran_by_users_id_fk" FOREIGN KEY ("ran_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_events" ADD CONSTRAINT "read_events_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_events" ADD CONSTRAINT "read_events_run_stop_id_run_stops_id_fk" FOREIGN KEY ("run_stop_id") REFERENCES "public"."run_stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_events" ADD CONSTRAINT "read_events_reader_id_users_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reread_tasks" ADD CONSTRAINT "reread_tasks_exception_id_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reread_tasks" ADD CONSTRAINT "reread_tasks_reader_id_users_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_runs" ADD CONSTRAINT "route_runs_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_runs" ADD CONSTRAINT "route_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_runs" ADD CONSTRAINT "route_runs_reader_id_users_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_stops" ADD CONSTRAINT "run_stops_run_id_route_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."route_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_stops" ADD CONSTRAINT "run_stops_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_stops" ADD CONSTRAINT "run_stops_skip_reason_id_skip_reasons_id_fk" FOREIGN KEY ("skip_reason_id") REFERENCES "public"."skip_reasons"("id") ON DELETE no action ON UPDATE no action;