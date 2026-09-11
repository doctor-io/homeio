import type { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { wipeDiskMock, requireApiSessionMock } = vi.hoisted(() => ({
  wipeDiskMock: vi.fn(),
  requireApiSessionMock: vi.fn(),
}));

vi.mock("@/lib/server/modules/system/disk-service", () => ({
  wipeDisk: wipeDiskMock,
}));

vi.mock("@/lib/server/modules/auth/api", () => ({
  requireApiSession: requireApiSessionMock,
}));

import { POST } from "@/app/api/v1/system/disks/wipe/route";
import { NextResponse } from "next/server";

describe("POST /api/v1/system/disks/wipe", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    wipeDiskMock.mockReset();
    requireApiSessionMock.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    requireApiSessionMock.mockResolvedValueOnce({
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const request = new Request("http://localhost/api/v1/system/disks/wipe", {
      method: "POST",
      body: JSON.stringify({ disk: "/dev/sdb" }),
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(401);
  });

  it("returns 400 when disk is missing", async () => {
    requireApiSessionMock.mockResolvedValueOnce({
      session: { userId: "user-1" },
      response: null,
    });

    const request = new Request("http://localhost/api/v1/system/disks/wipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("disk is required");
  });

  it("returns 400 when wipeDisk rejects for system/mounted disk safety", async () => {
    requireApiSessionMock.mockResolvedValueOnce({
      session: { userId: "user-1" },
      response: null,
    });
    wipeDiskMock.mockRejectedValueOnce(
      new Error("Cannot modify system device containing critical mountpoint (/boot/efi)")
    );

    const request = new Request("http://localhost/api/v1/system/disks/wipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disk: "/dev/sda" }),
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Cannot modify system device");
  });

  it("returns 200 when disk wipe succeeds", async () => {
    requireApiSessionMock.mockResolvedValueOnce({
      session: { userId: "user-1" },
      response: null,
    });
    wipeDiskMock.mockResolvedValueOnce(undefined);

    const request = new Request("http://localhost/api/v1/system/disks/wipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disk: "/dev/sdb" }),
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.accepted).toBe(true);
    expect(wipeDiskMock).toHaveBeenCalledWith("/dev/sdb");
  });
});
