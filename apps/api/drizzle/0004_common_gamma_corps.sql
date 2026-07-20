ALTER TABLE "export_runs" ADD COLUMN "format" text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "export_runs" ADD COLUMN "filename" text;--> statement-breakpoint
ALTER TABLE "export_runs" ADD COLUMN "body" text;