import { describe, expect, it } from "vitest";

import { mergeNotifications } from "@/modules/system/components/status-bar/use-status-bar-data";
import type { Notification } from "@/modules/system/components/status-bar/types";
import type { NotificationRecord } from "@/lib/shared/contracts/notifications";

function persisted(id: string, title: string, createdAt: string): NotificationRecord {
  return {
    id,
    title,
    body: "",
    kind: "info",
    read: false,
    createdAt,
  } as NotificationRecord;
}

function ephemeral(id: string, title: string, createdAt: string): Notification {
  return { id, title, message: "", time: "", createdAt, read: true };
}

describe("mergeNotifications", () => {
  it("orders the two sources together, not one after the other", () => {
    // Each list arrives sorted, so concatenating them left yesterday's app
    // events above a snapshot from minutes ago.
    const merged = mergeNotifications(
      [
        persisted("a", "App Redeployed", "2026-09-09T20:25:00.000Z"),
        persisted("b", "App Installed", "2026-09-09T20:23:00.000Z"),
      ],
      [
        ephemeral("system-snapshot", "System Snapshot", "2026-09-10T21:49:00.000Z"),
        ephemeral("session", "Active Session", "2026-09-10T21:48:00.000Z"),
      ],
    );

    expect(merged.map((item) => item.title)).toEqual([
      "System Snapshot",
      "Active Session",
      "App Redeployed",
      "App Installed",
    ]);
  });

  it("lets the persisted copy win when both sources carry an id", () => {
    const merged = mergeNotifications(
      [persisted("shared", "From the server", "2026-09-10T10:00:00.000Z")],
      [ephemeral("shared", "From the client", "2026-09-10T11:00:00.000Z")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("From the server");
  });

  it("keeps the newest when there are more than fit", () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      ephemeral(`e${index}`, `Event ${index}`, new Date(2026, 0, 1, 0, index).toISOString()),
    );

    const merged = mergeNotifications([], many);

    expect(merged).toHaveLength(20);
    expect(merged[0].title).toBe("Event 24");
  });
});
