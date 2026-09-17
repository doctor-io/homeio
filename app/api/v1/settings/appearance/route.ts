import { NextResponse } from "next/server";
import { db } from "@/lib/server/db/drizzle";
import { settings } from "@/lib/server/db/schema";
import { sanitizeAppearanceSettings } from "@/lib/desktop/appearance";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { readAppearanceSettings } from "@/lib/server/modules/settings/appearance-repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  return NextResponse.json({ data: await readAppearanceSettings() });
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
