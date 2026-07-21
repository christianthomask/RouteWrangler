CREATE INDEX "exceptions_read_event_idx" ON "exceptions" USING btree ("read_event_id");--> statement-breakpoint
CREATE INDEX "exceptions_meter_idx" ON "exceptions" USING btree ("meter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "export_runs_current_uq" ON "export_runs" USING btree ("client_id","cycle_id") WHERE "export_runs"."superseded_by_run_id" is null;--> statement-breakpoint
CREATE INDEX "export_runs_client_cycle_idx" ON "export_runs" USING btree ("client_id","cycle_id");--> statement-breakpoint
CREATE INDEX "meters_client_idx" ON "meters" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "read_events_meter_captured_idx" ON "read_events" USING btree ("meter_id","captured_at");--> statement-breakpoint
CREATE INDEX "read_events_meter_received_idx" ON "read_events" USING btree ("meter_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "read_events_run_stop_idx" ON "read_events" USING btree ("run_stop_id");--> statement-breakpoint
CREATE INDEX "route_runs_client_cycle_idx" ON "route_runs" USING btree ("client_id","cycle_id");--> statement-breakpoint
CREATE INDEX "run_stops_run_idx" ON "run_stops" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_client_serial_uq" UNIQUE("client_id","serial");--> statement-breakpoint
ALTER TABLE "run_stops" ADD CONSTRAINT "run_stops_run_meter_uq" UNIQUE("run_id","meter_id");--> statement-breakpoint
ALTER TABLE "run_stops" ADD CONSTRAINT "run_stops_run_seq_uq" UNIQUE("run_id","sequence");