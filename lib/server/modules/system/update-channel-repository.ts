import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/server/db/drizzle";
import { settings } from "@/lib/server/db/schema";
import type { SystemUpdateChannel } from "@/lib/shared/contracts/system";

export async function readUpdateChannel(): Promise<SystemUpdateChannel> {
  const [row] = await db
    .select({ channel: settings.updateChannel })
    .from(settings)
    .where(eq(settings.id, "singleton"))
    .limit(1);

  return row?.channel === "beta" ? "beta" : "stable";
}

export async function writeUpdateChannel(channel: SystemUpdateChannel) {
  await db
    .insert(settings)
    .values({ id: "singleton", updateChannel: channel })
    .onConflictDoUpdate({
      target: settings.id,
      set: { updateChannel: channel, updatedAt: new Date() },
    });
}
