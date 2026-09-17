--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_task_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"status" text NOT NULL,
	"output" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "scheduled_task_executions" ADD CONSTRAINT "scheduled_task_executions_task_id_scheduled_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."scheduled_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_task_executions_task_id_idx" ON "scheduled_task_executions" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_task_executions_started_at_idx" ON "scheduled_task_executions" USING btree ("started_at" DESC NULLS LAST);
--> statement-breakpoint
DROP INDEX IF EXISTS "api_tokens_created_at_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_tokens_created_at_idx" ON "api_tokens" USING btree ("created_at" DESC NULLS LAST);
