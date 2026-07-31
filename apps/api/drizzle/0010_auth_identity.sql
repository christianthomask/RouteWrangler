ALTER TABLE "users" RENAME COLUMN "cognito_sub" TO "auth_sub";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_cognito_sub_unique";--> statement-breakpoint
-- Invited staff have a role and an address but no identity yet, so the subject
-- id can no longer be required. drizzle-kit does not emit this for a column it
-- treated as a rename; the 0010 snapshot already records notNull:false, so
-- without this line the schema and the database disagree from here on.
ALTER TABLE "users" ALTER COLUMN "auth_sub" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_sub_unique" UNIQUE("auth_sub");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_identity_or_invite" CHECK ("users"."auth_sub" IS NOT NULL OR "users"."email" IS NOT NULL);
