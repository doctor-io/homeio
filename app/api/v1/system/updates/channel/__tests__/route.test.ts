import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/v1/system/updates/channel/route";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import {
  getSystemUpdateChannel,
  setSystemUpdateChannel,
  SystemUpdateConflictError,
} from "@/lib/server/modules/system/update-service";

vi.mock("@/lib/server/modules/system/update-service", () => ({
  getSystemUpdateChannel: vi.fn(),
  setSystemUpdateChannel: vi.fn(),
  SystemUpdateConflictError: class extends Error {},
}));

const url = "http://localhost/api/v1/system/updates/channel";

function saveChannel(channel: string) {
  return PUT(new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel }),
  }));
}

describe("system update channel", () => {
  it("loads and saves the server's channel", async () => {
    vi.mocked(getSystemUpdateChannel).mockResolvedValueOnce({ channel: "stable", disabledReason: null });
    vi.mocked(setSystemUpdateChannel).mockResolvedValueOnce({ channel: "beta", disabledReason: null });

    expect(await (await GET(new Request(url))).json()).toEqual({
      data: { channel: "stable", disabledReason: null },
    });
    const response = await saveChannel("beta");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { channel: "beta", disabledReason: null } });
    expect(setSystemUpdateChannel).toHaveBeenCalledWith("beta");
  });

  it("rejects unknown channels", async () => {
    expect((await saveChannel("develop")).status).toBe(400);
    expect(setSystemUpdateChannel).not.toHaveBeenCalled();
  });

  it("rejects changes while the channel is managed by the server", async () => {
    vi.mocked(setSystemUpdateChannel).mockRejectedValueOnce(new SystemUpdateConflictError("Channel is managed."));
    const response = await saveChannel("beta");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Channel is managed." });
  });

  it("requires an authenticated session to change the channel", async () => {
    vi.mocked(requireApiSession).mockResolvedValueOnce({
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await saveChannel("beta")).status).toBe(401);
    expect(setSystemUpdateChannel).not.toHaveBeenCalled();
  });
});
