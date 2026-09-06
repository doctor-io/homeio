import { beforeEach, describe, expect, it, vi } from "vitest";
import type { POST as LoginRoutePost } from "@/app/api/auth/login/route";
import { SECURITY_NOTIFICATION_TITLE } from "@/lib/shared/contracts/notifications";

type LoadedRoute = {
  POST: typeof LoginRoutePost;
  loginUser: ReturnType<typeof vi.fn>;
  AuthError: new (message: string, statusCode: number) => Error & {
    statusCode: number;
  };
};

async function loadRoute(): Promise<LoadedRoute> {
  vi.resetModules();

  vi.doMock("@/lib/server/modules/auth/service", () => {
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
      loginUser: vi.fn(),
    };
  });

  const routeModule = await import("@/app/api/auth/login/route");
  const serviceModule = await import("@/lib/server/modules/auth/service");

  return {
    POST: routeModule.POST,
    loginUser: vi.mocked(serviceModule.loginUser),
    AuthError: serviceModule.AuthError,
  };
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("sets a non-secure cookie for http requests", async () => {
    const { POST, loginUser } = await loadRoute();

    loginUser.mockResolvedValueOnce({
      kind: "session",
      token: "session-token",
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "u1", username: "admin" },
    });

    const request = new Request("http://192.168.1.67/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "StrongPass123" }),
    });

    const response = await POST(request);
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain("homeio_session=");
    expect(cookie).not.toContain("Secure");
  });

  it("sets a secure cookie for https requests (via x-forwarded-proto)", async () => {
    const { POST, loginUser } = await loadRoute();

    loginUser.mockResolvedValueOnce({
      kind: "session",
      token: "session-token",
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: "u1", username: "admin" },
    });

    const request = new Request("http://127.0.0.1:12026/api/auth/login", {
      method: "POST",
      headers: { "x-forwarded-proto": "https" },
      body: JSON.stringify({ username: "admin", password: "StrongPass123" }),
    });

    const response = await POST(request);
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain("homeio_session=");
    expect(cookie).toContain("Secure");
  });

  it("returns 401 on invalid credentials", async () => {
    const { POST, loginUser, AuthError } = await loadRoute();

    loginUser.mockRejectedValueOnce(
      new AuthError("Invalid username or password", 401),
    );

    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "bad-pass" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it("rate limits repeated failed attempts by username and client ip", async () => {
    const { POST, loginUser, AuthError } = await loadRoute();
    loginUser.mockRejectedValue(new AuthError("Invalid username or password", 401));

    for (let index = 0; index < 5; index += 1) {
      const response = await POST(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "x-real-ip": "192.0.2.10" },
          body: JSON.stringify({ username: "admin", password: "bad-pass" }),
        }),
      );
      expect(response.status).toBe(401);
    }

    const limited = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "x-real-ip": "192.0.2.10" },
        body: JSON.stringify({ username: "admin", password: "bad-pass" }),
      }),
    );

    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual({
      error: "Too many login attempts",
    });
  });

  it("raises one security notification when the lockout threshold is reached", async () => {
    const { POST, loginUser, AuthError } = await loadRoute();
    const { createNotification } = await import(
      "@/lib/server/modules/notifications/service"
    );
    vi.mocked(createNotification).mockClear();
    loginUser.mockRejectedValue(new AuthError("Invalid username or password", 401));

    const attempt = () =>
      POST(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "x-real-ip": "203.0.113.9" },
          body: JSON.stringify({ username: "admin", password: "bad-pass" }),
        }),
      );

    // A wrong password is a typo, so the first four say nothing.
    for (let index = 0; index < 4; index += 1) await attempt();
    expect(createNotification).not.toHaveBeenCalled();

    await attempt();
    expect(createNotification).toHaveBeenCalledTimes(1);

    const [payload] = vi.mocked(createNotification).mock.calls[0]!;
    expect(payload.title).toBe(SECURITY_NOTIFICATION_TITLE);
    expect(payload.kind).toBe("error");
    expect(payload.body).toContain("admin");
    expect(payload.body).toContain("203.0.113.9");

    // Further attempts are refused outright and must not repeat the alert.
    await attempt();
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it("does not share rate limits across client ips", async () => {
    const { POST, loginUser, AuthError } = await loadRoute();
    loginUser.mockRejectedValue(new AuthError("Invalid username or password", 401));

    for (let index = 0; index < 5; index += 1) {
      await POST(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "x-real-ip": "192.0.2.10" },
          body: JSON.stringify({ username: "admin", password: "bad-pass" }),
        }),
      );
    }

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "x-real-ip": "192.0.2.11" },
        body: JSON.stringify({ username: "admin", password: "bad-pass" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("clears failed attempts after a successful login", async () => {
    const { POST, loginUser, AuthError } = await loadRoute();
    loginUser
      .mockRejectedValueOnce(new AuthError("Invalid username or password", 401))
      .mockResolvedValueOnce({
        kind: "session",
        token: "session-token",
        expiresAt: new Date(Date.now() + 3600_000),
        user: { id: "u1", username: "admin" },
      })
      .mockRejectedValueOnce(new AuthError("Invalid username or password", 401));

    const makeRequest = (password: string) =>
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "x-real-ip": "192.0.2.12" },
        body: JSON.stringify({ username: "admin", password }),
      });

    expect((await POST(makeRequest("bad-pass"))).status).toBe(401);
    expect((await POST(makeRequest("StrongPass123"))).status).toBe(200);
    expect((await POST(makeRequest("bad-pass"))).status).toBe(401);
  });

  it("returns requiresTotp + partial token (no cookie) for TOTP-enabled users", async () => {
    const { POST, loginUser } = await loadRoute();

    loginUser.mockResolvedValueOnce({
      kind: "partial",
      partialAuthToken: "partial.u1.99999999.deadbeef",
      partialAuthExpiresAt: new Date(99999999_000),
      user: { id: "u1", username: "admin" },
    });

    const request = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "StrongPass123" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Critical: no session cookie may be set on the TOTP branch.
    expect(response.headers.get("set-cookie")).toBeNull();

    const json = (await response.json()) as {
      data: { requiresTotp: boolean; partialAuthToken: string };
    };
    expect(json.data).toEqual({
      requiresTotp: true,
      partialAuthToken: "partial.u1.99999999.deadbeef",
    });
  });

  it("clears rate-limit failures even on the partial-auth branch", async () => {
    const { POST, loginUser, AuthError } = await loadRoute();

    // Three failed attempts followed by a successful password (TOTP branch)
    // then another failure must NOT trip the 5-strike rate limit, because
    // the successful password should have reset the counter.
    loginUser
      .mockRejectedValueOnce(new AuthError("Invalid username or password", 401))
      .mockRejectedValueOnce(new AuthError("Invalid username or password", 401))
      .mockRejectedValueOnce(new AuthError("Invalid username or password", 401))
      .mockResolvedValueOnce({
        kind: "partial",
        partialAuthToken: "partial.u1.99999999.deadbeef",
        partialAuthExpiresAt: new Date(99999999_000),
        user: { id: "u1", username: "admin" },
      })
      .mockRejectedValueOnce(
        new AuthError("Invalid username or password", 401),
      );

    const makeRequest = (password: string) =>
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "x-real-ip": "192.0.2.99" },
        body: JSON.stringify({ username: "admin", password }),
      });

    expect((await POST(makeRequest("bad-1"))).status).toBe(401);
    expect((await POST(makeRequest("bad-2"))).status).toBe(401);
    expect((await POST(makeRequest("bad-3"))).status).toBe(401);
    expect((await POST(makeRequest("StrongPass123"))).status).toBe(200);
    expect((await POST(makeRequest("bad-4"))).status).toBe(401);
  });
});
