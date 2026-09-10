import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/auth/repository", () => ({
  createSession: vi.fn(),
  createUser: vi.fn(),
  deleteSessionById: vi.fn(),
  findSessionWithUser: vi.fn(),
  findUserByUsername: vi.fn(),
  findUserWithTotpByUsername: vi.fn(),
}));

vi.mock("@/lib/server/modules/auth/password", () => ({
  // Default to an async resolution so the service module's load-time
  // DUMMY_PASSWORD_HASH_PROMISE.hashPassword() call (equal-time defence on
  // the user-missing path) doesn't crash before any test runs.
  hashPassword: vi.fn(async () => "dummy-salt:dummy-hash"),
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/server/modules/auth/session-token", () => ({
  createSessionToken: vi.fn(),
  verifySessionToken: vi.fn(),
}));

vi.mock("@/lib/server/modules/auth/partial-auth-token", () => ({
  createPartialAuthToken: vi.fn(),
}));

vi.mock("@/lib/server/env", () => ({
  serverEnv: {
    AUTH_PRIMARY_USERNAME: "admin",
    AUTH_SESSION_HOURS: 168,
  },
}));

import {
  createSession,
  createUser,
  deleteSessionById,
  findSessionWithUser,
  findUserByUsername,
  findUserWithTotpByUsername,
} from "@/lib/server/modules/auth/repository";
import { hashPassword, verifyPassword } from "@/lib/server/modules/auth/password";
import { createPartialAuthToken } from "@/lib/server/modules/auth/partial-auth-token";
import {
  createSessionToken,
  verifySessionToken,
} from "@/lib/server/modules/auth/session-token";
import {
  AuthError,
  authenticateSession,
  loginUser,
  logoutSession,
  registerUser,
  verifyUnlockPassword,
} from "@/lib/server/modules/auth/service";

describe("auth service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a user", async () => {
    vi.mocked(findUserByUsername).mockResolvedValueOnce(null);
    vi.mocked(hashPassword).mockResolvedValueOnce("salt:hash");

    const result = await registerUser({
      username: "admin",
      password: "StrongPass123",
      confirmPassword: "StrongPass123",
    });

    expect(result.username).toBe("admin");
    expect(createUser).toHaveBeenCalledTimes(1);
  });

  it("fails registration when passwords mismatch", async () => {
    await expect(
      registerUser({
        username: "admin",
        password: "StrongPass123",
        confirmPassword: "WrongPass123",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("logs in user and creates session token when TOTP is off", async () => {
    vi.mocked(findUserWithTotpByUsername).mockResolvedValueOnce({
      id: "u1",
      username: "admin",
      passwordHash: "salt:hash",
      totpSecret: null,
      totpEnabled: false,
      totpBackupCodes: null,
      totpEnrolledAt: null,
      tourSeenAt: null,
    });
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(createSessionToken).mockReturnValueOnce("token-123");

    const result = await loginUser({
      username: "admin",
      password: "StrongPass123",
    });

    expect(result.kind).toBe("session");
    if (result.kind !== "session") throw new Error("expected session branch");
    expect(result.token).toBe("token-123");
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createPartialAuthToken).not.toHaveBeenCalled();
  });

  it("returns a partial-auth token (no session) when TOTP is enabled", async () => {
    vi.mocked(findUserWithTotpByUsername).mockResolvedValueOnce({
      id: "u1",
      username: "admin",
      passwordHash: "salt:hash",
      totpSecret: "enc:secret",
      totpEnabled: true,
      totpBackupCodes: "enc:codes",
      totpEnrolledAt: new Date("2026-05-20T00:00:00.000Z"),
      tourSeenAt: null,
    });
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(createPartialAuthToken).mockReturnValueOnce({
      token: "partial.u1.99999999.deadbeef",
      expiresAtEpochSeconds: 99999999,
    });

    const result = await loginUser({
      username: "admin",
      password: "StrongPass123",
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") throw new Error("expected partial branch");
    expect(result.partialAuthToken).toBe("partial.u1.99999999.deadbeef");
    expect(result.partialAuthExpiresAt.getTime()).toBe(99999999 * 1000);
    expect(result.user).toEqual({ id: "u1", username: "admin" });

    // No real session must be created on the TOTP branch.
    expect(createSession).not.toHaveBeenCalled();
    expect(createSessionToken).not.toHaveBeenCalled();
    expect(createPartialAuthToken).toHaveBeenCalledWith("u1");
  });

  it("rejects with 401 and still runs verifyPassword on an unknown username (equal-time)", async () => {
    // Equal-time defence: without the dummy-hash branch, the user-missing
    // path skips scrypt entirely and finishes in ~0 ms, while the user-
    // exists path runs a full verifyPassword (~tens of ms). An attacker
    // could enumerate usernames by timing alone. The service must call
    // verifyPassword against a fixed dummy hash on the miss path so the
    // wall-clock cost is comparable.
    vi.mocked(findUserWithTotpByUsername).mockResolvedValueOnce(null);
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);

    await expect(
      loginUser({ username: "no-such-user", password: "anything" }),
    ).rejects.toBeInstanceOf(AuthError);

    expect(verifyPassword).toHaveBeenCalledTimes(1);
    // The dummy hash is what was generated at module load; we don't pin its
    // exact value, but it must NOT be undefined / empty / the supplied
    // password's hash (since no user row was found).
    const [pwArg, hashArg] = vi.mocked(verifyPassword).mock.calls[0];
    expect(pwArg).toBe("anything");
    expect(typeof hashArg).toBe("string");
    expect(hashArg.length).toBeGreaterThan(0);
  });

  it("rejects invalid login", async () => {
    vi.mocked(findUserWithTotpByUsername).mockResolvedValueOnce({
      id: "u1",
      username: "admin",
      passwordHash: "salt:hash",
      totpSecret: null,
      totpEnabled: false,
      totpBackupCodes: null,
      totpEnrolledAt: null,
      tourSeenAt: null,
    });
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);

    await expect(
      loginUser({ username: "admin", password: "bad-pass" }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(createPartialAuthToken).not.toHaveBeenCalled();
  });

  it("does not leak a partial token when the password is wrong on a TOTP user", async () => {
    vi.mocked(findUserWithTotpByUsername).mockResolvedValueOnce({
      id: "u1",
      username: "admin",
      passwordHash: "salt:hash",
      totpSecret: "enc:secret",
      totpEnabled: true,
      totpBackupCodes: "enc:codes",
      totpEnrolledAt: new Date(),
      tourSeenAt: null,
    });
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);

    await expect(
      loginUser({ username: "admin", password: "bad-pass" }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(createPartialAuthToken).not.toHaveBeenCalled();
  });

  it("authenticates a valid session token", async () => {
    vi.mocked(verifySessionToken).mockReturnValueOnce({
      sessionId: "s1",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600,
    });
    vi.mocked(findSessionWithUser).mockResolvedValueOnce({
      sessionId: "s1",
      userId: "u1",
      username: "admin",
      passwordHash: "salt:hash",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const session = await authenticateSession("token-123");

    expect(session?.username).toBe("admin");
  });

  it("logs out by deleting session", async () => {
    vi.mocked(verifySessionToken).mockReturnValueOnce({
      sessionId: "s1",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600,
    });

    await logoutSession("token-123");

    expect(deleteSessionById).toHaveBeenCalledWith("s1");
  });

  it("verifies unlock password", async () => {
    vi.mocked(verifySessionToken).mockReturnValueOnce({
      sessionId: "s1",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600,
    });
    vi.mocked(findSessionWithUser).mockResolvedValueOnce({
      sessionId: "s1",
      userId: "u1",
      username: "admin",
      passwordHash: "salt:hash",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);

    const unlocked = await verifyUnlockPassword({
      sessionToken: "token-123",
      password: "StrongPass123",
    });

    expect(unlocked.username).toBe("admin");
  });
});
