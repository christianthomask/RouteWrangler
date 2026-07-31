-- Supersede could never have worked. `export_runs.superseded_by_run_id` points
-- at another export run, and the second export for a client+cycle has to mark
-- the current one superseded BY the row it is about to insert. The prior row is
-- updated first on purpose — the partial unique index allows only one
-- non-superseded export per client+cycle, so inserting first would break it —
-- but that update pointed the foreign key at a row that did not exist yet, and
-- an immediate constraint rejected it. Every re-run returned a 500.
--
-- Deferring the constraint keeps both invariants: between the two statements the
-- reference is dangling and there is exactly one current row, and at COMMIT both
-- are true. The partial unique index stays immediate, which is why the update
-- must still come before the insert.
--
-- Hand-written because drizzle's schema DSL cannot express DEFERRABLE. A
-- regenerated snapshot will not silently undo it: drizzle does not model
-- deferrability at all, so it sees no difference to emit. See the comment on
-- `exportRuns.supersededByRunId` in schema.ts.
ALTER TABLE "export_runs"
  DROP CONSTRAINT "export_runs_superseded_by_run_id_export_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "export_runs"
  ADD CONSTRAINT "export_runs_superseded_by_run_id_export_runs_id_fk"
  FOREIGN KEY ("superseded_by_run_id") REFERENCES "public"."export_runs"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;
