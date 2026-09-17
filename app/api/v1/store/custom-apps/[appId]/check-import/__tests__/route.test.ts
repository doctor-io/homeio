import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireApiSession, mockFetchCompose, mockFindTemplate, mockBackfill } = vi.hoisted(() => ({
  mockRequireApiSession: vi.fn(),
  mockFetchCompose: vi.fn(),
  mockFindTemplate: vi.fn(),
  mockBackfill: vi.fn(),
}));

vi.mock("@/lib/server/modules/auth/api", async () => {
  const { NextResponse: Res } = await import("next/server");
  return {
    requireApiSession: mockRequireApiSession,
    unauthorizedApiResponse: () => Res.json({ error: "Unauthorized" }, { status: 401 }),
  };
});

vi.mock("@/lib/server/modules/store/compose-import", async () => {
  class ComposeImportError extends Error {
    readonly statusCode: number;
    readonly code: string;
    constructor(code: string, message: string, statusCode = 400) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  }
  return { ComposeImportError, fetchComposeFromUrl: mockFetchCompose };
});

vi.mock("@/lib/server/modules/store/custom-apps", async () => {
  const { createHash } = await import("node:crypto");
  return {
    findCustomStoreTemplateByAppId: mockFindTemplate,
    backfillCustomStoreChecksum: mockBackfill,
    checksumSource: (value: string) => createHash("sha256").update(value).digest("hex"),
  };
});

import { POST } from "@/app/api/v1/store/custom-apps/[appId]/check-import/route";
import { ComposeImportError } from "@/lib/server/modules/store/compose-import";

const COMPOSE = "services:\n  web:\n    image: nginx\n";
const CHECKSUM = "07d1c1dd5c0f60c0dbf4e0f76b9d8b1a3b0d2a6ba0f5e2b3e6b2c5c67c0e2ad1";

function req(appId = "custom-thing") {
  return {
    request: new NextRequest(`http://localhost/api/v1/store/custom-apps/${appId}/check-import`, {
      method: "POST",
      headers: { cookie: "homeio_session=t" },
    }),
    context: { params: Promise.resolve({ appId }) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiSession.mockResolvedValue({
    session: { sessionId: "s", userId: "u", username: "a", passwordHash: "h", expiresAt: new Date() },
    response: null,
  });
});

describe("POST /api/v1/store/custom-apps/[appId]/check-import", () => {
  it("returns 401 for unauthenticated requests", async () => {
    mockRequireApiSession.mockResolvedValueOnce({
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const { request, context } = req();
    expect((await POST(request, context)).status).toBe(401);
    expect(mockFetchCompose).not.toHaveBeenCalled();
  });

  it("404s for an unknown app", async () => {
    mockFindTemplate.mockResolvedValueOnce(null);

    const { request, context } = req();
    expect((await POST(request, context)).status).toBe(404);
  });

  it("refuses an app that was pasted rather than imported", async () => {
    mockFindTemplate.mockResolvedValueOnce({ sourceUrl: null, sourceChecksum: null });

    const { request, context } = req();
    const response = await POST(request, context);
    const json = (await response.json()) as { code: string };

    expect(response.status).toBe(409);
    expect(json.code).toBe("not_imported");
    expect(mockFetchCompose).not.toHaveBeenCalled();
  });

  it("reports no change when the checksum still matches", async () => {
    const { createHash } = await import("node:crypto");
    const checksum = createHash("sha256").update(COMPOSE).digest("hex");
    mockFindTemplate.mockResolvedValueOnce({
      sourceUrl: "https://example.com/c.yml",
      sourceRef: null,
      lastImportedAt: "2026-08-28T00:00:00.000Z",
      sourceChecksum: checksum,
    });
    mockFetchCompose.mockResolvedValueOnce({ url: "https://example.com/c.yml", content: COMPOSE, bytes: 40 });

    const { request, context } = req();
    const json = (await (await POST(request, context)).json()) as { data: { changed: boolean } };

    expect(json.data.changed).toBe(false);
  });

  it("reports a change when upstream has moved", async () => {
    mockFindTemplate.mockResolvedValueOnce({
      sourceUrl: "https://example.com/c.yml",
      sourceRef: "v1",
      lastImportedAt: "2026-08-28T00:00:00.000Z",
      sourceChecksum: CHECKSUM,
    });
    mockFetchCompose.mockResolvedValueOnce({
      url: "https://example.com/c.yml",
      content: "services:\n  web:\n    image: caddy\n",
      bytes: 40,
    });

    const { request, context } = req();
    const json = (await (await POST(request, context)).json()) as {
      data: { changed: boolean; upstreamContent: string };
    };

    expect(json.data.changed).toBe(true);
    expect(json.data.upstreamContent).toContain("caddy");
  });

  it("treats a row with no stored checksum as changed rather than claiming a match", async () => {
    mockFindTemplate.mockResolvedValueOnce({
      sourceUrl: "https://example.com/c.yml",
      sourceRef: null,
      lastImportedAt: null,
      sourceChecksum: null,
    });
    mockFetchCompose.mockResolvedValueOnce({ url: "https://example.com/c.yml", content: COMPOSE, bytes: 40 });

    const { request, context } = req();
    const json = (await (await POST(request, context)).json()) as { data: { changed: boolean } };

    expect(json.data.changed).toBe(true);
  });

  it("passes a fetch refusal through with its own status", async () => {
    mockFindTemplate.mockResolvedValueOnce({
      sourceUrl: "https://example.com/c.yml",
      sourceChecksum: CHECKSUM,
    });
    mockFetchCompose.mockRejectedValueOnce(
      new ComposeImportError("private_host", "That address is on a private network.", 400),
    );

    const { request, context } = req();
    const response = await POST(request, context);
    const json = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(json.code).toBe("private_host");
  });
});

describe("a row imported before checksums existed", () => {
  const SOURCE = "services:\n  web:\n    image: nginx\n";

  function templateWithoutChecksum() {
    mockFindTemplate.mockResolvedValue({
      appId: "custom-thing",
      sourceUrl: "https://example.com/compose.yml",
      sourceRef: null,
      lastImportedAt: null,
      sourceChecksum: null,
      sourceText: SOURCE,
    });
  }

  it("proves the match against the stored text instead of claiming a change", async () => {
    // It answered "changed" on every read and wrote nothing back, so the app
    // claimed an update for as long as it existed and nothing could clear it.
    templateWithoutChecksum();
    mockFetchCompose.mockResolvedValue({ url: "https://example.com/compose.yml", content: SOURCE, bytes: SOURCE.length });

    const { request, context } = req();
    const body = await (await POST(request, context)).json();

    expect(body.data.changed).toBe(false);
  });

  it("records the checksum so the next read is an ordinary one", async () => {
    templateWithoutChecksum();
    mockFetchCompose.mockResolvedValue({ url: "https://example.com/compose.yml", content: SOURCE, bytes: SOURCE.length });

    const { request, context } = req();
    await POST(request, context);

    expect(mockBackfill).toHaveBeenCalledWith("custom-thing", expect.any(String));
  });

  it("still reports a real upstream change", async () => {
    // The control: back-filling must not blind the thing it is meant to unblock.
    templateWithoutChecksum();
    const moved = `${SOURCE}    restart: always\n`;
    mockFetchCompose.mockResolvedValue({ url: "https://example.com/compose.yml", content: moved, bytes: moved.length });

    const { request, context } = req();
    const body = await (await POST(request, context)).json();

    expect(body.data.changed).toBe(true);
  });

  it("keeps saying changed when there is nothing at all to compare", async () => {
    mockFindTemplate.mockResolvedValue({
      appId: "custom-thing",
      sourceUrl: "https://example.com/compose.yml",
      sourceRef: null,
      lastImportedAt: null,
      sourceChecksum: null,
      sourceText: null,
    });
    mockFetchCompose.mockResolvedValue({ url: "https://example.com/compose.yml", content: SOURCE, bytes: SOURCE.length });

    const { request, context } = req();
    const body = await (await POST(request, context)).json();

    expect(body.data.changed).toBe(true);
    expect(mockBackfill).not.toHaveBeenCalled();
  });
});
