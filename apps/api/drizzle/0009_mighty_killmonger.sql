ALTER TABLE "exceptions" ALTER COLUMN "read_event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exceptions" ADD COLUMN "run_stop_id" uuid;--> statement-breakpoint
ALTER TABLE "run_stops" ADD COLUMN "skip_photo_key" text;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_run_stop_id_run_stops_id_fk" FOREIGN KEY ("run_stop_id") REFERENCES "public"."run_stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exceptions_run_stop_idx" ON "exceptions" USING btree ("run_stop_id");--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_one_target" CHECK (("exceptions"."read_event_id" IS NULL) <> ("exceptions"."run_stop_id" IS NULL));