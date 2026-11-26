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

export function withLockedUpdateChannel<T>(action: (channel: SystemUpdateChannel) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // Settings can be absent on a fresh install. Ensure there is a row to lock.
    await tx.insert(settings).values({ id: "singleton" }).onConflictDoNothing({ target: settings.id });
    const [row] = await tx
      .select({ channel: settings.updateChannel })
      .from(settings)
      .where(eq(settings.id, "singleton"))
      .for("update");

    if (!row) throw new Error("Could not lock the Homeio update channel settings.");
    return action(row.channel === "beta" ? "beta" : "stable");
  });
}
