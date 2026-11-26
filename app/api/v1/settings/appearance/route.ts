import { NextResponse } from "next/server";
import { db } from "@/lib/server/db/drizzle";
import { settings } from "@/lib/server/db/schema";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  sanitizeAppearanceSettings,
  type AppearanceSettings,
} from "@/lib/desktop/appearance";
import { eq } from "drizzle-orm";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

async function getAppearance(): Promise<{ appearance: AppearanceSettings; hasSavedTheme: boolean }> {
  const rows = await db.select().from(settings).where(eq(settings.id, "singleton")).limit(1);
  if (rows.length === 0 || !rows[0].appearanceJson) {
    return { appearance: DEFAULT_APPEARANCE_SETTINGS, hasSavedTheme: false };
  }
  const raw = rows[0].appearanceJson as Partial<AppearanceSettings>;
  return {
    appearance: sanitizeAppearanceSettings(raw),
    hasSavedTheme: raw.theme === "dark" || raw.theme === "light" || raw.theme === "system",
  };
}

export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  try {
    const { appearance, hasSavedTheme } = await getAppearance();
    return NextResponse.json({ data: appearance, hasSavedTheme });
  } catch {
    return NextResponse.json({ data: DEFAULT_APPEARANCE_SETTINGS });
  }
}

export async function PUT(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  try {
    const body = await request.json();
    const appearance = sanitizeAppearanceSettings(body);

    await db
      .insert(settings)
      .values({ id: "singleton", appearanceJson: appearance })
      .onConflictDoUpdate({
        target: settings.id,
        set: { appearanceJson: appearance, updatedAt: new Date() },
      });

    return NextResponse.json({ data: appearance });
  } catch (err) {
    console.error("[appearance PUT]", err);
    return NextResponse.json({ error: "Failed to save appearance" }, { status: 500 });
  }
}
