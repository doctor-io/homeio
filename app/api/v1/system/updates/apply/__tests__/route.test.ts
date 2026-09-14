import type { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { scheduleSystemUpdateMock, requireApiSessionMock } = vi.hoisted(() => ({
  scheduleSystemUpdateMock: vi.fn(),
  requireApiSessionMock: vi.fn(),
}));

vi.mock("@/lib/server/modules/system/update-service", () => ({
  scheduleSystemUpdate: scheduleSystemUpdateMock,
}));

vi.mock("@/lib/server/modules/auth/api", () => ({
  requireApiSession: requireApiSessionMock,
}));

import { POST } from "@/app/api/v1/system/updates/apply/route";
import { NextResponse } from "next/server";

describe("POST /api/v1/system/updates/apply", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    scheduleSystemUpdateMock.mockReset();
    requireApiSessionMock.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    requireApiSessionMock.mockResolvedValueOnce({
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const request = new Request("http://localhost/api/v1/system/updates/apply", {
      method: "POST",
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(401);
  });

  it("returns 400 with helpful message when running in Docker container", async () => {
    requireApiSessionMock.mockResolvedValueOnce({
      session: { userId: "user-1", username: "admin" },
      response: null,
    });
    scheduleSystemUpdateMock.mockRejectedValueOnce(
      new Error(
        "Homeio is running in a Docker container. In-app self-update via systemd is disabled. Please update your container using: docker compose pull && docker compose up -d"
      )
    );

    const request = new Request("http://localhost/api/v1/system/updates/apply", {
      method: "POST",
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Docker container");
  });

  it("returns 202 when update is accepted", async () => {
    requireApiSessionMock.mockResolvedValueOnce({
      session: { userId: "user-1", username: "admin" },
      response: null,
    });
    scheduleSystemUpdateMock.mockResolvedValueOnce({ accepted: true, action: "update" });

    const request = new Request("http://localhost/api/v1/system/updates/apply", {
      method: "POST",
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(202);
    const json = await response.json();
    expect(json.data.accepted).toBe(true);
  });
});
