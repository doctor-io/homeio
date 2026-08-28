import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireApiSession, mockFetchCompose, mockUpsert } = vi.hoisted(() => ({
  mockRequireApiSession: vi.fn(),
  mockFetchCompose: vi.fn(),
  mockUpsert: vi.fn(),
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

vi.mock("@/lib/server/modules/store/custom-apps", () => ({
  upsertCustomStoreTemplate: mockUpsert,
}));

import { POST } from "@/app/api/v1/store/custom-apps/import/route";
import { ComposeImportError } from "@/lib/server/modules/store/compose-import";

const COMPOSE = "services:\n  web:\n    image: nginx\n";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/v1/store/custom-apps/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { cookie: "homeio_session=t" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiSession.mockResolvedValue({
    session: { sessionId: "s", userId: "u", username: "ahmed", passwordHash: "h", expiresAt: new Date() },
    response: null,
  });
  mockUpsert.mockImplementation(async (input: Record<string, unknown>) => ({
    ...input,
    isCustom: true,
  }));
});

describe("POST /api/v1/store/custom-apps/import", () => {
  it("returns 401 for unauthenticated requests", async () => {
    mockRequireApiSession.mockResolvedValueOnce({
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(req({ url: "https://example.com/c.yml" }));

    expect(response.status).toBe(401);
    expect(mockFetchCompose).not.toHaveBeenCalled();
  });

  it("rejects a payload with no URL", async () => {
    const response = await POST(req({}));

    expect(response.status).toBe(400);
    expect(mockFetchCompose).not.toHaveBeenCalled();
  });

  it("stores the fetched document with its provenance", async () => {
    mockFetchCompose.mockResolvedValueOnce({
      url: "https://raw.githubusercontent.com/acme/stack/main/docker-compose.yml",
      content: COMPOSE,
      bytes: COMPOSE.length,
    });

    const response = await POST(
      req({ url: "https://raw.githubusercontent.com/acme/stack/main/docker-compose.yml", ref: "9f2c1ab" }),
    );

    expect(response.status).toBe(201);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "url",
        sourceText: COMPOSE,
        sourceUrl: "https://raw.githubusercontent.com/acme/stack/main/docker-compose.yml",
        sourceRef: "9f2c1ab",
      }),
    );
  });

  it("names an app after its directory when the file is just compose.yml", async () => {
    mockFetchCompose.mockResolvedValueOnce({
      url: "https://raw.githubusercontent.com/acme/immich-stack/main/docker-compose.yml",
      content: COMPOSE,
      bytes: COMPOSE.length,
    });

    await POST(req({ url: "https://example.com/x" }));

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "main" }),
    );
  });

  it("prefers a name the caller supplied", async () => {
    mockFetchCompose.mockResolvedValueOnce({
      url: "https://example.com/docker-compose.yml",
      content: COMPOSE,
      bytes: COMPOSE.length,
    });

    await POST(req({ url: "https://example.com/docker-compose.yml", name: "My Stack" }));

    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ name: "My Stack" }));
  });

  it("passes a blocked host through with its own status and code", async () => {
    mockFetchCompose.mockRejectedValueOnce(
      new ComposeImportError("private_host", "That address is on a private network."),
    );

    const response = await POST(req({ url: "https://localhost/c.yml" }));
    const json = (await response.json()) as { code: string; error: string };

    expect(response.status).toBe(400);
    expect(json.code).toBe("private_host");
    expect(json.error).toContain("private network");
  });

  it("reports an unparsable document as the user's file, not a server fault", async () => {
    mockFetchCompose.mockResolvedValueOnce({
      url: "https://example.com/index.html",
      content: "<!doctype html>",
      bytes: 15,
    });
    mockUpsert.mockRejectedValueOnce(new Error("Invalid compose document"));

    const response = await POST(req({ url: "https://example.com/index.html" }));
    const json = (await response.json()) as { code: string };

    expect(response.status).toBe(422);
    expect(json.code).toBe("invalid_compose");
  });

  it("does not leak an unexpected failure to the client", async () => {
    mockFetchCompose.mockRejectedValueOnce(new Error("ECONNRESET on internal socket"));

    const response = await POST(req({ url: "https://example.com/c.yml" }));
    const json = (await response.json()) as { code: string; error: string };

    expect(response.status).toBe(500);
    expect(json.code).toBe("internal_error");
    expect(json.error).not.toContain("ECONNRESET");
  });
});
