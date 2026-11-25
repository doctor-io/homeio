import type { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { scheduleSystemUpdateMock, requireApiSessionMock, emitPowerActionMock } = vi.hoisted(() => ({
  scheduleSystemUpdateMock: vi.fn(),
  requireApiSessionMock: vi.fn(),
  emitPowerActionMock: vi.fn(),
}));

vi.mock("@/lib/server/modules/system/power-action-events", () => ({
  emitPowerAction: emitPowerActionMock,
}));

vi.mock("@/lib/server/modules/system/update-service", () => ({
  scheduleSystemUpdate: scheduleSystemUpdateMock,
  SystemUpdateConflictError: class extends Error {},
}));

vi.mock("@/lib/server/modules/auth/api", () => ({
  requireApiSession: requireApiSessionMock,
}));

import { POST } from "@/app/api/v1/system/updates/apply/route";
import { SystemUpdateConflictError } from "@/lib/server/modules/system/update-service";
import { NextResponse } from "next/server";

describe("POST /api/v1/system/updates/apply", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    scheduleSystemUpdateMock.mockReset();
    requireApiSessionMock.mockReset();
    emitPowerActionMock.mockReset();
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
    expect(emitPowerActionMock).not.toHaveBeenCalled();
  });

  it("returns 202 when update is accepted", async () => {
    requireApiSessionMock.mockResolvedValueOnce({
      session: { userId: "user-1", username: "admin" },
      response: null,
    });
    scheduleSystemUpdateMock.mockResolvedValueOnce({ accepted: true, action: "update" });

    const request = new Request("http://localhost/api/v1/system/updates/apply?version=2.0.0-beta.1", {
      method: "POST",
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(202);
    expect(scheduleSystemUpdateMock).toHaveBeenCalledWith("2.0.0-beta.1");
    const json = await response.json();
    expect(json.data.accepted).toBe(true);
    // Other open sessions switch to the update screen too.
    expect(emitPowerActionMock).toHaveBeenCalledWith("update");
  });

  it("returns 409 when the advertised update has changed", async () => {
    requireApiSessionMock.mockResolvedValueOnce({
      session: { userId: "user-1", username: "admin" },
      response: null,
    });
    scheduleSystemUpdateMock.mockRejectedValueOnce(new SystemUpdateConflictError("Check again."));

    const request = new Request("http://localhost/api/v1/system/updates/apply?version=2.0.0-beta.1", {
      method: "POST",
    });
    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Check again." });
    expect(emitPowerActionMock).not.toHaveBeenCalled();
  });
});
