import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/auth/service", () => ({
  authenticateSession: vi.fn(),
}));

vi.mock("@/lib/server/modules/system/backup-service", () => ({
  runSystemBackupNow: vi.fn(),
}));

import { POST } from "@/app/api/v1/system/backups/run/route";
import { authenticateSession } from "@/lib/server/modules/auth/service";
import { runSystemBackupNow } from "@/lib/server/modules/system/backup-service";

describe("POST /api/v1/system/backups/run", () => {
  it("returns 202 and backup metadata for authenticated users", async () => {
    vi.mocked(authenticateSession).mockResolvedValueOnce({
      sessionId: "s1",
      userId: "u1",
      username: "ahmed",
      passwordHash: "salt:hash",
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.mocked(runSystemBackupNow).mockResolvedValueOnce({
      id: "backup-1",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 1024,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: "/DATA/Backups/homeio/backup-1.tar.gz",
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: true,
      status: "completed",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/v1/system/backups/run", {
        method: "POST",
        headers: {
          cookie: "homeio_session=session-token",
        },
      }),
    );
    const json = (await response.json()) as { data: { accepted: boolean; backup: { id: string } } };

    expect(response.status).toBe(202);
    expect(json.data.accepted).toBe(true);
    expect(json.data.backup.id).toBe("backup-1");
  });
});
