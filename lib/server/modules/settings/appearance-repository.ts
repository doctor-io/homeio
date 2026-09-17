import "server-only";

import { eq } from "drizzle-orm";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  sanitizeAppearanceSettings,
  type AppearanceSettings,
} from "@/lib/desktop/appearance";
import { db } from "@/lib/server/db/drizzle";
import { settings } from "@/lib/server/db/schema";

/**
 * The appearance settings as stored, or the defaults.
 *
 * Appearance is a single server-wide row, not a per-user document, which is
 * what lets the signed-out pages render it: /login, /register and /setup read
 * it here at request time rather than asking the API, which requires a session
 * they do not have yet.
 *
 * A database that cannot be read is not a reason to refuse to draw the login
 * page — the caller gets the defaults and the operator can still sign in.
 */
export async function readAppearanceSettings(): Promise<AppearanceSettings> {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.id, "singleton"))
      .limit(1);

    if (rows.length === 0 || !rows[0].appearanceJson) {
      return DEFAULT_APPEARANCE_SETTINGS;
    }

    return sanitizeAppearanceSettings(rows[0].appearanceJson);
  } catch {
    return DEFAULT_APPEARANCE_SETTINGS;
  }
}
