import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/server/db/drizzle";
import { settings } from "@/lib/server/db/schema";
import { ONBOARDING_LAST_STEP } from "@/lib/shared/contracts/onboarding";

export type OnboardingRow = {
  onboardingState: string | null;
  onboardingStep: number | null;
  onboardingCompletedAt: Date | null;
  timezone: string | null;
  defaultStorageRoot: string | null;
};

async function ensureSettingsRow() {
  await db.execute(sql`
    INSERT INTO settings (id, appearance_json, updated_at)
    VALUES ('singleton', '{}', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
}

export async function findOnboardingRow(): Promise<OnboardingRow | null> {
  await ensureSettingsRow();

  const rows = await db
    .select({
      onboardingState: settings.onboardingState,
      onboardingStep: settings.onboardingStep,
      onboardingCompletedAt: settings.onboardingCompletedAt,
      timezone: settings.timezone,
      defaultStorageRoot: settings.defaultStorageRoot,
    })
    .from(settings)
    .where(eq(settings.id, "singleton"))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Marks the wizard as pending. Guarded on `onboarding_state IS NULL` so it can
 * only ever fire once: re-running it against an install that is mid-wizard or
 * already finished is a no-op, which keeps it safe under `db:init` (which
 * replays every migration) and repeated container starts.
 */
export async function markOnboardingPending(): Promise<void> {
  await ensureSettingsRow();

  await db.execute(sql`
    UPDATE settings
    SET onboarding_state = 'pending',
        onboarding_step = 1,
        updated_at = NOW()
    WHERE id = 'singleton'
      AND onboarding_state IS NULL
  `);
}

/**
 * Persists the values collected so far. Only writes columns the caller
 * actually supplied, so a step never clears another step's answer.
 */
export async function saveOnboardingProgress(input: {
  step: number;
  timezone?: string | null;
  defaultStorageRoot?: string | null;
}): Promise<void> {
  await ensureSettingsRow();

  const timezone = input.timezone === undefined ? sql`timezone` : sql`${input.timezone}`;
  const storageRoot =
    input.defaultStorageRoot === undefined
      ? sql`default_storage_root`
      : sql`${input.defaultStorageRoot}`;

  await db.execute(sql`
    UPDATE settings
    SET onboarding_step = ${input.step},
        timezone = ${timezone},
        default_storage_root = ${storageRoot},
        updated_at = NOW()
    WHERE id = 'singleton'
      AND onboarding_state = 'pending'
  `);
}

export async function markOnboardingComplete(): Promise<void> {
  await ensureSettingsRow();

  // The last step, read from the constant rather than written out. It said 5
  // while the wizard has six, so finishing at step 6 wrote the progress
  // *backwards* to 5 — and would have gone on saying 5 the day a seventh step
  // was added. Nothing routes on this today, since the gate reads the status;
  // it is the stored answer to "how far did they get" that was wrong.
  await db.execute(sql`
    UPDATE settings
    SET onboarding_state = 'complete',
        onboarding_step = ${ONBOARDING_LAST_STEP},
        onboarding_completed_at = NOW(),
        updated_at = NOW()
    WHERE id = 'singleton'
      AND onboarding_state = 'pending'
  `);
}
