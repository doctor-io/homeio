import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/auth/repository", () => ({
  hasAnyUsers: vi.fn(),
}));

vi.mock("@/lib/server/modules/auth/service", () => {
  class AuthError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  }

  return {
    AuthError,
    registerUser: vi.fn(),
    // Registration signs the account in now, so the route needs a session.
    startSession: vi.fn(async (user: { id: string; username: string }) => ({
      token: "session-token",
      expiresAt: new Date(Date.now() + 3_600_000),
      user,
    })),
  };
});

vi.mock("@/lib/server/modules/store/catalog", () => ({
  bootstrapDefaultCasaosCatalog: vi.fn(),
}));

vi.mock("@/lib/server/modules/onboarding/service", () => ({
  startOnboarding: vi.fn(),
}));

vi.mock("@/lib/server/storage/data-root", () => ({
  ensureDataRootDirectories: vi.fn(),
  resolveDataRootDirectory: vi.fn(() => "/DATA"),
}));

import { POST } from "@/app/api/auth/register/route";
import { hasAnyUsers } from "@/lib/server/modules/auth/repository";
import { registerUser } from "@/lib/server/modules/auth/service";
import { startOnboarding } from "@/lib/server/modules/onboarding/service";
import { bootstrapDefaultCasaosCatalog } from "@/lib/server/modules/store/catalog";
import { ensureDataRootDirectories } from "@/lib/server/storage/data-root";
import { getAuthCookieName } from "@/lib/server/modules/auth/cookies";

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when registration is disabled", async () => {
    vi.mocked(hasAnyUsers).mockResolvedValueOnce(true);

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: "StrongPass123",
        confirmPassword: "StrongPass123",
      }),
    });

    const response = await POST(request);
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(json.error).toContain("disabled");
    expect(registerUser).not.toHaveBeenCalled();
    expect(ensureDataRootDirectories).not.toHaveBeenCalled();
    expect(bootstrapDefaultCasaosCatalog).not.toHaveBeenCalled();
  });

  it("allows first registration when no users exist and bootstraps the catalog", async () => {
    vi.mocked(hasAnyUsers).mockResolvedValueOnce(false);
    vi.mocked(bootstrapDefaultCasaosCatalog).mockResolvedValueOnce({
      path: "/DATA/AppStore/CasaOS-AppStore",
      indexedApps: 10,
    });
    vi.mocked(registerUser).mockResolvedValueOnce({
      id: "11111111-1111-1111-1111-111111111111",
      username: "admin",
    });

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: "StrongPass123",
        confirmPassword: "StrongPass123",
      }),
    });

    const response = await POST(request);
    const json = (await response.json()) as {
      data: { username: string };
    };

    expect(response.status).toBe(201);
    expect(json.data.username).toBe("admin");
    expect(ensureDataRootDirectories).toHaveBeenCalledTimes(1);
    expect(bootstrapDefaultCasaosCatalog).toHaveBeenCalledTimes(1);
    expect(startOnboarding).toHaveBeenCalledTimes(1);
  });

  it("does not reopen the wizard when an account already exists", async () => {
    vi.mocked(hasAnyUsers).mockResolvedValueOnce(true);
    vi.mocked(registerUser).mockResolvedValueOnce({
      id: "22222222-2222-2222-2222-222222222222",
      username: "second",
    });
    process.env.AUTH_ALLOW_REGISTRATION = "true";

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: "second",
        password: "StrongPass123",
        confirmPassword: "StrongPass123",
      }),
    });

    await POST(request);

    expect(startOnboarding).not.toHaveBeenCalled();
    delete process.env.AUTH_ALLOW_REGISTRATION;
  });

  it("still registers the account when opening the wizard fails", async () => {
    vi.mocked(hasAnyUsers).mockResolvedValueOnce(false);
    vi.mocked(bootstrapDefaultCasaosCatalog).mockResolvedValueOnce({
      path: "/DATA/AppStore/CasaOS-AppStore",
      indexedApps: 10,
    });
    vi.mocked(registerUser).mockResolvedValueOnce({
      id: "33333333-3333-3333-3333-333333333333",
      username: "admin",
    });
    vi.mocked(startOnboarding).mockRejectedValueOnce(new Error("db down"));

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: "StrongPass123",
        confirmPassword: "StrongPass123",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
  });
});

describe("POST /api/auth/register · session", () => {
  it("signs the new account in so setup follows registration directly", async () => {
    // Sending them to the login screen asks for the password they just chose,
    // before they have seen anything of the product.
    vi.mocked(hasAnyUsers).mockResolvedValueOnce(false);
    vi.mocked(registerUser).mockResolvedValueOnce({
      id: "user-1",
      username: "ahmed",
    } as never);

    const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: "ahmed",
        password: "StrongPass123",
        confirmPassword: "StrongPass123",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(response.cookies.get(getAuthCookieName())?.value).toBe("session-token");
  });
});
