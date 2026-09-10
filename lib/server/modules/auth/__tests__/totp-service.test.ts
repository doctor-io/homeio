import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/auth/repository", () => ({
  findUserWithTotpById: vi.fn(),
  setPendingTotpSecret: vi.fn(),
  completeTotpEnrollment: vi.fn(),
  clearTotpEnrollment: vi.fn(),
  updateTotpBackupCodes: vi.fn(),
  createSession: vi.fn(),
  deleteSessionsForUser: vi.fn(),
}));

vi.mock("@/lib/server/modules/auth/partial-auth-token", () => ({
  verifyPartialAuthToken: vi.fn(),
}));

vi.mock("@/lib/server/modules/auth/session-token", () => ({
  createSessionToken: vi.fn(
    (sessionId: string, exp: number) => `sess.${sessionId}.${exp}.sig`,
  ),
}));

vi.mock("@/lib/server/env", () => ({
  serverEnv: { AUTH_SESSION_HOURS: 168 },
}));

vi.mock("@/lib/server/modules/auth/totp-crypto", () => ({
  encryptSecret: vi.fn((plaintext: string) => `enc:${plaintext}`),
  decryptSecret: vi.fn((packed: string) => packed.replace(/^enc:/, "")),
}));

vi.mock("@/lib/server/modules/auth/rate-limit", () => ({
  isTotpCodeReplayed: vi.fn(() => false),
  markTotpCodeUsed: vi.fn(),
  isPartialAuthTokenBlocked: vi.fn(() => false),
  isPartialAuthTokenConsumed: vi.fn(() => false),
  markPartialAuthTokenConsumed: vi.fn(),
  recordPartialAuthFailure: vi.fn(),
}));

vi.mock("@/lib/server/modules/auth/totp", () => ({
  generateTotpSecret: vi.fn((username: string) => ({
    secret: "JBSWY3DPEHPK3PXP",
    otpAuthUrl: `otpauth://totp/Homeio%3A${encodeURIComponent(username)}?secret=JBSWY3DPEHPK3PXP&issuer=Homeio&algorithm=SHA1&digits=6&period=30`,
  })),
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(async () => ({ matchedHash: null })),
  generateBackupCodes: vi.fn(async () => ({
    plaintext: ["AAAAAAAAAA", "BBBBBBBBBB"],
    hashes: ["salt-a:hash-a", "salt-b:hash-b"],
  })),
}));

vi.mock("qrcode", () => ({
  toString: vi.fn(async () => '<svg data-mock="qr">…</svg>'),
}));

import {
  TotpServiceError,
  beginTotpEnrollment,
  completeTotpEnrollment,
  completeTotpLogin,
  disableTotp,
} from "@/lib/server/modules/auth/totp-service";
import {
  clearTotpEnrollment as persistClearedTotp,
  completeTotpEnrollment as persistEnrolledTotp,
  createSession,
  deleteSessionsForUser,
  findUserWithTotpById,
  setPendingTotpSecret,
  updateTotpBackupCodes,
} from "@/lib/server/modules/auth/repository";
import { verifyPartialAuthToken } from "@/lib/server/modules/auth/partial-auth-token";
import { createSessionToken } from "@/lib/server/modules/auth/session-token";
import {
  isPartialAuthTokenBlocked,
  isPartialAuthTokenConsumed,
  isTotpCodeReplayed,
  markPartialAuthTokenConsumed,
  markTotpCodeUsed,
  recordPartialAuthFailure,
} from "@/lib/server/modules/auth/rate-limit";
import {
  decryptSecret,
  encryptSecret,
} from "@/lib/server/modules/auth/totp-crypto";
import {
  verifyBackupCode,
  verifyTotp,
} from "@/lib/server/modules/auth/totp";

const PENDING_USER = {
  id: "user-1",
  username: "admin",
  passwordHash: "hash",
  totpSecret: "enc:JBSWY3DPEHPK3PXP",
  totpEnabled: false,
  totpBackupCodes: null,
  totpEnrolledAt: null,
  tourSeenAt: null,
};

const FRESH_USER = {
  ...PENDING_USER,
  totpSecret: null,
};

const ENROLLED_USER = {
  ...PENDING_USER,
  totpEnabled: true,
  totpBackupCodes: "enc:" + JSON.stringify(["salt-a:hash-a", "salt-b:hash-b"]),
  totpEnrolledAt: new Date("2026-05-20T00:00:00.000Z"),
  tourSeenAt: null,
};

beforeEach(() => {
  vi.mocked(findUserWithTotpById).mockReset();
  // CAS-style helpers return true by default so the happy path keeps working;
  // tests covering CAS-loss override with mockResolvedValueOnce(false).
  vi.mocked(setPendingTotpSecret).mockReset().mockResolvedValue(true);
  vi.mocked(persistEnrolledTotp).mockReset().mockResolvedValue(true);
  vi.mocked(persistClearedTotp).mockReset();
  vi.mocked(updateTotpBackupCodes).mockReset().mockResolvedValue(true);
  vi.mocked(createSession).mockReset();
  vi.mocked(deleteSessionsForUser).mockReset();
  vi.mocked(encryptSecret).mockClear();
  vi.mocked(decryptSecret).mockClear();
  vi.mocked(verifyTotp).mockReset();
  vi.mocked(verifyBackupCode)
    .mockReset()
    .mockResolvedValue({ matchedHash: null });
  vi.mocked(isTotpCodeReplayed).mockReset().mockReturnValue(false);
  vi.mocked(markTotpCodeUsed).mockReset();
  vi.mocked(verifyPartialAuthToken).mockReset();
  vi.mocked(createSessionToken).mockClear();
  vi.mocked(isPartialAuthTokenBlocked).mockReset().mockReturnValue(false);
  vi.mocked(isPartialAuthTokenConsumed).mockReset().mockReturnValue(false);
  vi.mocked(markPartialAuthTokenConsumed).mockReset();
  vi.mocked(recordPartialAuthFailure).mockReset();
});

describe("beginTotpEnrollment", () => {
  it("generates a secret, stores its ciphertext, and returns SVG + URL", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...FRESH_USER });

    const result = await beginTotpEnrollment("user-1");

    expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    expect(result.otpAuthUrl).toMatch(/^otpauth:\/\/totp\/Homeio%3Aadmin\?/);
    expect(result.qrCodeSvg).toContain("<svg");

    expect(vi.mocked(setPendingTotpSecret)).toHaveBeenCalledTimes(1);
    const [storedUserId, storedCiphertext] = vi
      .mocked(setPendingTotpSecret)
      .mock.calls[0];
    expect(storedUserId).toBe("user-1");
    expect(storedCiphertext).toBe(`enc:${result.secret}`);
    expect(storedCiphertext).not.toBe(result.secret);
  });

  it("rejects with 'already_enabled' (409) when totp_enabled is true", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({
      ...FRESH_USER,
      totpEnabled: true,
      totpEnrolledAt: new Date(),
      tourSeenAt: null,
    });

    await expect(beginTotpEnrollment("user-1")).rejects.toMatchObject({
      name: "TotpServiceError",
      code: "already_enabled",
      statusCode: 409,
    });
    expect(vi.mocked(setPendingTotpSecret)).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the user row no longer exists", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce(null);

    const error = await beginTotpEnrollment("ghost-user").catch((e) => e);
    expect(error).toBeInstanceOf(TotpServiceError);
    expect(error.statusCode).toBe(401);
    expect(vi.mocked(setPendingTotpSecret)).not.toHaveBeenCalled();
  });

  it("maps a CAS loss on setPendingTotpSecret to already_enabled (409)", async () => {
    // Concurrent /verify completed enrolment between our read and our write,
    // so the conditional UPDATE matched zero rows. We must not return a QR
    // for a secret the DB will never accept.
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...FRESH_USER });
    vi.mocked(setPendingTotpSecret).mockResolvedValueOnce(false);

    await expect(beginTotpEnrollment("user-1")).rejects.toMatchObject({
      code: "already_enabled",
      statusCode: 409,
    });
  });
});

describe("completeTotpEnrollment", () => {
  it("returns the plaintext backup codes and persists the enrolled state on success", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...PENDING_USER });
    vi.mocked(verifyTotp).mockReturnValueOnce(true);

    const result = await completeTotpEnrollment({
      userId: "user-1",
      code: "123456",
    });

    expect(result.enabled).toBe(true);
    expect(result.backupCodes).toEqual(["AAAAAAAAAA", "BBBBBBBBBB"]);
    expect(result.enrolledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // The decrypted secret must reach verifyTotp, never the ciphertext.
    expect(vi.mocked(verifyTotp)).toHaveBeenCalledWith(
      "JBSWY3DPEHPK3PXP",
      "123456",
    );

    // The backup-code JSON written to the DB must be encrypted, and must
    // NOT contain the plaintext codes.
    expect(vi.mocked(persistEnrolledTotp)).toHaveBeenCalledTimes(1);
    const stored = vi.mocked(persistEnrolledTotp).mock.calls[0][0];
    expect(stored.userId).toBe("user-1");
    expect(stored.encryptedBackupCodes).toMatch(/^enc:/);
    expect(stored.encryptedBackupCodes).not.toContain("AAAAAAAAAA");
    expect(stored.enrolledAt).toBeInstanceOf(Date);

    // Successful code is marked used so its replay is rejected.
    expect(vi.mocked(markTotpCodeUsed)).toHaveBeenCalledWith(
      "user-1",
      "123456",
    );
  });

  it("rejects with invalid_totp (400) when the code does not verify", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...PENDING_USER });
    vi.mocked(verifyTotp).mockReturnValueOnce(false);

    await expect(
      completeTotpEnrollment({ userId: "user-1", code: "000000" }),
    ).rejects.toMatchObject({
      name: "TotpServiceError",
      code: "invalid_totp",
      statusCode: 400,
    });

    expect(vi.mocked(persistEnrolledTotp)).not.toHaveBeenCalled();
    expect(vi.mocked(markTotpCodeUsed)).not.toHaveBeenCalled();
  });

  it("rejects replays of the most recently accepted code with invalid_totp", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...PENDING_USER });
    vi.mocked(isTotpCodeReplayed).mockReturnValueOnce(true);

    await expect(
      completeTotpEnrollment({ userId: "user-1", code: "123456" }),
    ).rejects.toMatchObject({
      code: "invalid_totp",
      statusCode: 400,
    });

    // Verification must not even run when the replay guard trips, so we
    // don't waste HMAC cycles and the code looks identical to a wrong code.
    expect(vi.mocked(verifyTotp)).not.toHaveBeenCalled();
    expect(vi.mocked(persistEnrolledTotp)).not.toHaveBeenCalled();
  });

  it("rejects with no_pending_enrollment (409) when totp_secret is null", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...FRESH_USER });

    await expect(
      completeTotpEnrollment({ userId: "user-1", code: "123456" }),
    ).rejects.toMatchObject({
      code: "no_pending_enrollment",
      statusCode: 409,
    });
    expect(vi.mocked(verifyTotp)).not.toHaveBeenCalled();
  });

  it("rejects with already_enabled (409) when totp is already turned on", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({
      ...PENDING_USER,
      totpEnabled: true,
      totpEnrolledAt: new Date(),
      tourSeenAt: null,
    });

    await expect(
      completeTotpEnrollment({ userId: "user-1", code: "123456" }),
    ).rejects.toMatchObject({
      code: "already_enabled",
      statusCode: 409,
    });
    expect(vi.mocked(verifyTotp)).not.toHaveBeenCalled();
  });

  it("rejects with invalid_totp when the stored secret cannot be decrypted", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...PENDING_USER });
    vi.mocked(decryptSecret).mockImplementationOnce(() => {
      throw new Error("auth tag mismatch");
    });

    await expect(
      completeTotpEnrollment({ userId: "user-1", code: "123456" }),
    ).rejects.toMatchObject({
      code: "invalid_totp",
      statusCode: 400,
    });
    expect(vi.mocked(verifyTotp)).not.toHaveBeenCalled();
    expect(vi.mocked(persistEnrolledTotp)).not.toHaveBeenCalled();
  });

  it("returns 401 when the user no longer exists", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce(null);

    await expect(
      completeTotpEnrollment({ userId: "ghost", code: "123456" }),
    ).rejects.toMatchObject({
      code: "not_enrolled",
      statusCode: 401,
    });
  });

  it("maps a CAS loss on completeTotpEnrollment to already_enabled (409)", async () => {
    // Two near-simultaneous /verify calls (e.g., a UI double-click): the
    // first flipped totp_enabled on with its backup codes; ours matched zero
    // rows. Must NOT return our locally-generated backup codes because they
    // do not exist in the DB — the user would be locked out of recovery.
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...PENDING_USER });
    vi.mocked(verifyTotp).mockReturnValueOnce(true);
    vi.mocked(persistEnrolledTotp).mockResolvedValueOnce(false);

    await expect(
      completeTotpEnrollment({ userId: "user-1", code: "123456" }),
    ).rejects.toMatchObject({
      code: "already_enabled",
      statusCode: 409,
    });
    // Replay guard must not register a successful use either, since the
    // outcome to the caller is "already enabled, retry path".
    expect(vi.mocked(markTotpCodeUsed)).not.toHaveBeenCalled();
  });
});

describe("disableTotp", () => {
  it("clears the enrolment when the TOTP code is valid", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...ENROLLED_USER });
    vi.mocked(verifyTotp).mockReturnValueOnce(true);

    const result = await disableTotp({ userId: "user-1", code: "123456" });

    expect(result).toEqual({ enabled: false });
    expect(vi.mocked(verifyTotp)).toHaveBeenCalledWith(
      "JBSWY3DPEHPK3PXP",
      "123456",
    );
    // Backup-code path must not run when TOTP already matched.
    expect(vi.mocked(verifyBackupCode)).not.toHaveBeenCalled();
    expect(vi.mocked(persistClearedTotp)).toHaveBeenCalledWith("user-1");
    // Every session for the user is revoked — disabling 2FA is a credential-
    // grade change and we force a fresh login on every device.
    expect(vi.mocked(deleteSessionsForUser)).toHaveBeenCalledWith("user-1");
    expect(vi.mocked(markTotpCodeUsed)).toHaveBeenCalledWith(
      "user-1",
      "123456",
    );
  });

  it("clears the enrolment when a backup code is valid", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...ENROLLED_USER });
    vi.mocked(verifyBackupCode).mockResolvedValueOnce({
      matchedHash: "salt-a:hash-a",
    });

    const result = await disableTotp({
      userId: "user-1",
      code: "AAAA-AAAA-AA",
    });

    expect(result).toEqual({ enabled: false });
    // TOTP path is shape-gated so a non-digit code must skip verifyTotp.
    expect(vi.mocked(verifyTotp)).not.toHaveBeenCalled();
    expect(vi.mocked(verifyBackupCode)).toHaveBeenCalledWith(
      ["salt-a:hash-a", "salt-b:hash-b"],
      "AAAA-AAAA-AA",
    );
    expect(vi.mocked(persistClearedTotp)).toHaveBeenCalledWith("user-1");
  });

  it("falls back to the backup-code path when the TOTP code is wrong", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...ENROLLED_USER });
    vi.mocked(verifyTotp).mockReturnValueOnce(false);
    vi.mocked(verifyBackupCode).mockResolvedValueOnce({
      matchedHash: "salt-b:hash-b",
    });

    const result = await disableTotp({ userId: "user-1", code: "000000" });

    expect(result).toEqual({ enabled: false });
    expect(vi.mocked(verifyTotp)).toHaveBeenCalled();
    expect(vi.mocked(verifyBackupCode)).toHaveBeenCalled();
    expect(vi.mocked(persistClearedTotp)).toHaveBeenCalledWith("user-1");
  });

  it("rejects with invalid_totp (400) when neither path matches", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...ENROLLED_USER });
    vi.mocked(verifyTotp).mockReturnValueOnce(false);
    vi.mocked(verifyBackupCode).mockResolvedValueOnce({ matchedHash: null });

    await expect(
      disableTotp({ userId: "user-1", code: "999999" }),
    ).rejects.toMatchObject({
      code: "invalid_totp",
      statusCode: 400,
    });

    expect(vi.mocked(persistClearedTotp)).not.toHaveBeenCalled();
    expect(vi.mocked(markTotpCodeUsed)).not.toHaveBeenCalled();
  });

  it("rejects with not_enabled (409) when TOTP is not currently on", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...PENDING_USER });

    await expect(
      disableTotp({ userId: "user-1", code: "123456" }),
    ).rejects.toMatchObject({
      code: "not_enabled",
      statusCode: 409,
    });

    expect(vi.mocked(verifyTotp)).not.toHaveBeenCalled();
    expect(vi.mocked(verifyBackupCode)).not.toHaveBeenCalled();
    expect(vi.mocked(persistClearedTotp)).not.toHaveBeenCalled();
  });

  it("rejects replays with invalid_totp before doing any HMAC work", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...ENROLLED_USER });
    vi.mocked(isTotpCodeReplayed).mockReturnValueOnce(true);

    await expect(
      disableTotp({ userId: "user-1", code: "123456" }),
    ).rejects.toMatchObject({
      code: "invalid_totp",
      statusCode: 400,
    });

    expect(vi.mocked(verifyTotp)).not.toHaveBeenCalled();
    expect(vi.mocked(verifyBackupCode)).not.toHaveBeenCalled();
    expect(vi.mocked(persistClearedTotp)).not.toHaveBeenCalled();
  });

  it("returns 401 when the user row is missing", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce(null);

    await expect(
      disableTotp({ userId: "ghost", code: "123456" }),
    ).rejects.toMatchObject({
      code: "not_enrolled",
      statusCode: 401,
    });
    expect(vi.mocked(persistClearedTotp)).not.toHaveBeenCalled();
  });

  it("maps a corrupt TOTP ciphertext to invalid_totp", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...ENROLLED_USER });
    vi.mocked(decryptSecret).mockImplementationOnce(() => {
      throw new Error("auth tag mismatch");
    });

    await expect(
      disableTotp({ userId: "user-1", code: "123456" }),
    ).rejects.toMatchObject({
      code: "invalid_totp",
      statusCode: 400,
    });
    expect(vi.mocked(persistClearedTotp)).not.toHaveBeenCalled();
  });

  it("maps a corrupt backup-code ciphertext to invalid_totp", async () => {
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...ENROLLED_USER });
    // First decryptSecret call is for totpSecret (succeeds); second is for
    // backup-codes blob (throws). Only triggered if TOTP path fails and we
    // try backup — use a non-digit code to skip TOTP entirely.
    vi.mocked(decryptSecret).mockImplementationOnce(() => {
      throw new Error("auth tag mismatch");
    });

    await expect(
      disableTotp({ userId: "user-1", code: "AAAAAAAAAA" }),
    ).rejects.toMatchObject({
      code: "invalid_totp",
      statusCode: 400,
    });
    expect(vi.mocked(verifyBackupCode)).not.toHaveBeenCalled();
    expect(vi.mocked(persistClearedTotp)).not.toHaveBeenCalled();
  });
});

describe("completeTotpLogin", () => {
  it("issues a session on a valid TOTP code", async () => {
    vi.mocked(verifyPartialAuthToken).mockReturnValueOnce({
      userId: "user-1",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60,
    });
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...ENROLLED_USER });
    vi.mocked(verifyTotp).mockReturnValueOnce(true);

    const result = await completeTotpLogin({
      partialAuthToken: "partial.user-1.99999999.sig",
      code: "123456",
    });

    expect(result.sessionToken).toMatch(/^sess\./);
    expect(result.user).toEqual({ id: "user-1", username: "admin" });
    expect(vi.mocked(createSession)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSessionToken)).toHaveBeenCalledTimes(1);
    // No backup code consumed on the TOTP path.
    expect(vi.mocked(updateTotpBackupCodes)).not.toHaveBeenCalled();
    expect(vi.mocked(markTotpCodeUsed)).toHaveBeenCalledWith(
      "user-1",
      "123456",
    );
    // Successful exchange burns the partial token so it cannot be reused.
    expect(vi.mocked(markPartialAuthTokenConsumed)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordPartialAuthFailure)).not.toHaveBeenCalled();
  });

  it("rejects with too_many_attempts (429) when the partial token is blocked", async () => {
    vi.mocked(verifyPartialAuthToken).mockReturnValueOnce({
      userId: "user-1",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60,
    });
    vi.mocked(isPartialAuthTokenBlocked).mockReturnValueOnce(true);

    await expect(
      completeTotpLogin({
        partialAuthToken: "partial.user-1.99999999.sig",
        code: "123456",
      }),
    ).rejects.toMatchObject({
      code: "too_many_attempts",
      statusCode: 429,
    });

    expect(vi.mocked(findUserWithTotpById)).not.toHaveBeenCalled();
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
  });

  it("rejects with partial_auth_consumed (401) once the token has been used", async () => {
    vi.mocked(verifyPartialAuthToken).mockReturnValueOnce({
      userId: "user-1",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60,
    });
    vi.mocked(isPartialAuthTokenConsumed).mockReturnValueOnce(true);

    await expect(
      completeTotpLogin({
        partialAuthToken: "partial.user-1.99999999.sig",
        code: "123456",
      }),
    ).rejects.toMatchObject({
      code: "partial_auth_consumed",
      statusCode: 401,
    });

    expect(vi.mocked(findUserWithTotpById)).not.toHaveBeenCalled();
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
  });

  it("records a partial-auth failure on an invalid_totp result", async () => {
    vi.mocked(verifyPartialAuthToken).mockReturnValueOnce({
      userId: "user-1",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60,
    });
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...ENROLLED_USER });
    vi.mocked(verifyTotp).mockReturnValueOnce(false);
    vi.mocked(verifyBackupCode).mockResolvedValueOnce({ matchedHash: null });

    await expect(
      completeTotpLogin({
        partialAuthToken: "partial.user-1.99999999.sig",
        code: "999999",
      }),
    ).rejects.toMatchObject({
      code: "invalid_totp",
      statusCode: 401,
    });

    // Failure is counted against the brute-force budget for this partial
    // token; the token itself is not invalidated (still valid until expiry).
    expect(vi.mocked(recordPartialAuthFailure)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(markPartialAuthTokenConsumed)).not.toHaveBeenCalled();
  });

  it("refuses a backup code whose hash was consumed concurrently (CAS loss)", async () => {
    // Two concurrent /login/totp calls with different backup codes both read
    // the same blob; the first one already wrote the pruned version, so our
    // CAS update returns false and we can't decode the same hash a second
    // time. Refuse the login — single-use means single-use.
    vi.mocked(verifyPartialAuthToken).mockReturnValueOnce({
      userId: "user-1",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60,
    });
    vi.mocked(findUserWithTotpById)
      .mockResolvedValueOnce({ ...ENROLLED_USER })
      // CAS retry: refetch returns the already-pruned blob without our hash.
      .mockResolvedValueOnce({
        ...ENROLLED_USER,
        totpBackupCodes: "enc:" + JSON.stringify(["salt-b:hash-b"]),
      });
    vi.mocked(verifyBackupCode).mockResolvedValueOnce({
      matchedHash: "salt-a:hash-a",
    });
    vi.mocked(updateTotpBackupCodes).mockResolvedValueOnce(false);

    await expect(
      completeTotpLogin({
        partialAuthToken: "partial.user-1.99999999.sig",
        code: "AAAA-AAAA-AA",
      }),
    ).rejects.toMatchObject({
      code: "invalid_totp",
      statusCode: 401,
    });

    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
  });

  it("issues a session AND prunes the matched hash when a backup code is used", async () => {
    vi.mocked(verifyPartialAuthToken).mockReturnValueOnce({
      userId: "user-1",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60,
    });
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...ENROLLED_USER });
    vi.mocked(verifyBackupCode).mockResolvedValueOnce({
      matchedHash: "salt-a:hash-a",
    });

    const result = await completeTotpLogin({
      partialAuthToken: "partial.user-1.99999999.sig",
      code: "AAAA-AAAA-AA",
    });

    expect(result.sessionToken).toMatch(/^sess\./);

    expect(vi.mocked(updateTotpBackupCodes)).toHaveBeenCalledTimes(1);
    const params = vi.mocked(updateTotpBackupCodes).mock.calls[0][0];
    expect(params.userId).toBe("user-1");
    // CAS: the previous blob must equal what we read; the next blob is the
    // JSON array minus the consumed hash, re-encrypted via our `enc:` mock.
    expect(params.previousBackupCodes).toBe(ENROLLED_USER.totpBackupCodes);
    expect(params.nextBackupCodes).toBe(
      `enc:${JSON.stringify(["salt-b:hash-b"])}`,
    );
  });

  it("rejects with partial_auth_expired when the token is missing or invalid", async () => {
    vi.mocked(verifyPartialAuthToken).mockReturnValueOnce(null);

    await expect(
      completeTotpLogin({
        partialAuthToken: "garbage",
        code: "123456",
      }),
    ).rejects.toMatchObject({
      code: "partial_auth_expired",
      statusCode: 401,
    });

    expect(vi.mocked(findUserWithTotpById)).not.toHaveBeenCalled();
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
  });

  it("rejects with invalid_totp (401) when the user vanished between A7 and A8", async () => {
    vi.mocked(verifyPartialAuthToken).mockReturnValueOnce({
      userId: "ghost",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60,
    });
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce(null);

    await expect(
      completeTotpLogin({
        partialAuthToken: "partial.ghost.99999999.sig",
        code: "123456",
      }),
    ).rejects.toMatchObject({
      code: "invalid_totp",
      statusCode: 401,
    });
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
  });

  it("rejects with invalid_totp when TOTP was disabled between A7 and A8", async () => {
    vi.mocked(verifyPartialAuthToken).mockReturnValueOnce({
      userId: "user-1",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60,
    });
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({
      ...ENROLLED_USER,
      totpEnabled: false,
    });

    await expect(
      completeTotpLogin({
        partialAuthToken: "partial.user-1.99999999.sig",
        code: "123456",
      }),
    ).rejects.toMatchObject({
      code: "invalid_totp",
      statusCode: 401,
    });
    expect(vi.mocked(verifyTotp)).not.toHaveBeenCalled();
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
  });

  it("rejects with invalid_totp on a wrong code without consuming anything", async () => {
    vi.mocked(verifyPartialAuthToken).mockReturnValueOnce({
      userId: "user-1",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60,
    });
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...ENROLLED_USER });
    vi.mocked(verifyTotp).mockReturnValueOnce(false);
    vi.mocked(verifyBackupCode).mockResolvedValueOnce({ matchedHash: null });

    await expect(
      completeTotpLogin({
        partialAuthToken: "partial.user-1.99999999.sig",
        code: "999999",
      }),
    ).rejects.toMatchObject({
      code: "invalid_totp",
      statusCode: 401,
    });
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
    expect(vi.mocked(updateTotpBackupCodes)).not.toHaveBeenCalled();
    expect(vi.mocked(markTotpCodeUsed)).not.toHaveBeenCalled();
  });

  it("rejects with invalid_totp on a replay", async () => {
    vi.mocked(verifyPartialAuthToken).mockReturnValueOnce({
      userId: "user-1",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 60,
    });
    vi.mocked(findUserWithTotpById).mockResolvedValueOnce({ ...ENROLLED_USER });
    vi.mocked(isTotpCodeReplayed).mockReturnValueOnce(true);

    await expect(
      completeTotpLogin({
        partialAuthToken: "partial.user-1.99999999.sig",
        code: "123456",
      }),
    ).rejects.toMatchObject({
      code: "invalid_totp",
      statusCode: 401,
    });
    expect(vi.mocked(verifyTotp)).not.toHaveBeenCalled();
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
  });
});
