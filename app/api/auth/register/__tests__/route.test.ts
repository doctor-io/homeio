import { describe, expect, it, vi } from "vitest";

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
  };
});

vi.mock("@/lib/server/modules/store/catalog", () => ({
  bootstrapDefaultCasaosCatalog: vi.fn(),
}));

vi.mock("@/lib/server/storage/data-root", () => ({
  ensureDataRootDirectories: vi.fn(),
  resolveDataRootDirectory: vi.fn(() => "/DATA"),
}));

import { POST } from "@/app/api/auth/register/route";
import { hasAnyUsers } from "@/lib/server/modules/auth/repository";
import { registerUser } from "@/lib/server/modules/auth/service";
import { bootstrapDefaultCasaosCatalog } from "@/lib/server/modules/store/catalog";
import { ensureDataRootDirectories } from "@/lib/server/storage/data-root";

describe("POST /api/auth/register", () => {
  it("refuses a second account, whatever the environment says", async () => {
    // The database is the only authority on this. There used to be an
    // AUTH_ALLOW_REGISTRATION env var alongside it, which install.sh set to
    // `true` and never unset — so a script-installed server kept handing out
    // full accounts to anyone who could reach the endpoint.
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
    expect(json.error).toContain("already has an account");
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
  });
});
