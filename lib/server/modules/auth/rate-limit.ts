import "server-only";

import { createHash } from "node:crypto";

const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_FAILURES = 5;
const USER_RATE_LIMIT_MAX_FAILURES = 10;

type LoginAttemptRecord = {
  failures: number;
  resetAt: number;
};

const loginAttempts = new Map<string, LoginAttemptRecord>();
const userAttempts = new Map<string, LoginAttemptRecord>();

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

const IPV4_RE = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

function sanitizeIp(raw: string | undefined | null): string {
  if (!raw) return "unknown";
  const trimmed = raw.trim();
  if (IPV4_RE.test(trimmed) || IPV6_RE.test(trimmed)) {
    return trimmed;
  }
  return "unknown";
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const candidate = forwardedFor.split(",")[0]?.trim();
    return sanitizeIp(candidate);
  }

  return sanitizeIp(request.headers.get("x-real-ip"));
}

export function getLoginRateLimitKey(request: Request, username: string) {
  return `${normalizeUsername(username)}:${getClientIp(request)}`;
}

export function isLoginRateLimited(key: string, now = Date.now()) {
  const record = loginAttempts.get(key);
  if (record) {
    if (record.resetAt <= now) {
      loginAttempts.delete(key);
    } else if (record.failures >= LOGIN_RATE_LIMIT_MAX_FAILURES) {
      return true;
    }
  }

  // Account-level lockout: guard against distributed/spoofed attacks on a single user
  const username = key.split(":")[0];
  if (username) {
    const userRecord = userAttempts.get(username);
    if (userRecord) {
      if (userRecord.resetAt <= now) {
        userAttempts.delete(username);
      } else if (userRecord.failures >= USER_RATE_LIMIT_MAX_FAILURES) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Records a failed sign-in and returns how many have accumulated in the current
 * window. Callers that only throttle can ignore the value; the count is what
 * lets a security notification fire once, when the lockout threshold is
 * reached, instead of once per attempt.
 */
export function recordLoginFailure(key: string, now = Date.now()) {
  const existing = loginAttempts.get(key);
  if (!existing || existing.resetAt <= now) {
    loginAttempts.set(key, {
      failures: 1,
      resetAt: now + LOGIN_RATE_LIMIT_WINDOW_MS,
    });
  } else {
    existing.failures += 1;
  }

  // Account-level counter, so a spread of source addresses still trips a lockout.
  const username = key.split(":")[0];
  if (username) {
    const existingUser = userAttempts.get(username);
    if (!existingUser || existingUser.resetAt <= now) {
      userAttempts.set(username, {
        failures: 1,
        resetAt: now + LOGIN_RATE_LIMIT_WINDOW_MS,
      });
    } else {
      existingUser.failures += 1;
    }
  }

  return loginAttempts.get(key)?.failures ?? 1;
}

/** The failure count at which sign-in is refused, and worth telling someone about. */
export const LOGIN_FAILURE_ALERT_THRESHOLD = LOGIN_RATE_LIMIT_MAX_FAILURES;

export function clearLoginFailures(key: string) {
  loginAttempts.delete(key);
  const username = key.split(":")[0];
  if (username) {
    userAttempts.delete(username);
  }
}

export function _resetLoginRateLimitForTesting() {
  loginAttempts.clear();
  userAttempts.clear();
}

// --- TOTP single-use guard ---------------------------------------------------
//
// RFC 6238 verification allows a small clock-drift window (±1 step by default),
// which means the same 6-digit code is valid for ~90 seconds. We must not let
// an attacker that observes a code reuse it during that window. We track the
// most recently accepted code per user and reject any retry of the exact same
// code until the acceptance window has elapsed.

const TOTP_REPLAY_RECORD_TTL_MS = 120 * 1000;

type TotpReplayRecord = {
  code: string;
  expiresAt: number;
};

const totpReplayGuard = new Map<string, TotpReplayRecord>();

export function isTotpCodeReplayed(
  userId: string,
  code: string,
  now = Date.now(),
) {
  const record = totpReplayGuard.get(userId);
  if (!record) return false;

  if (record.expiresAt <= now) {
    totpReplayGuard.delete(userId);
    return false;
  }

  return record.code === code;
}

export function markTotpCodeUsed(userId: string, code: string, now = Date.now()) {
  totpReplayGuard.set(userId, {
    code,
    expiresAt: now + TOTP_REPLAY_RECORD_TTL_MS,
  });
}

export function _resetTotpReplayGuardForTesting() {
  totpReplayGuard.clear();
}

// --- Partial-auth token guards ----------------------------------------------
//
// Two independent guards keyed by a sha256 fingerprint of the partial-auth
// token. We never keep the raw token in memory; the hash is enough to spot
// repeat callers.
//
// 1. `partialAuthFailureGuard` rate-limits brute-force grinding against the
//    /api/v1/auth/login/totp endpoint. The token itself is allowed to be
//    re-tried until expiry (per the A8 spec), but five wrong codes against
//    the same token trip a 429 until the token's natural expiry.
// 2. `partialAuthConsumedGuard` enforces single-use: once a token success-
//    fully exchanges for a real session, subsequent presentations of that
//    same token are rejected even if cryptographically valid.

const PARTIAL_AUTH_MAX_FAILURES = 5;
const PARTIAL_AUTH_GUARD_BUFFER_MS = 30 * 1000;

type PartialAuthFailureRecord = {
  failures: number;
  expiresAt: number;
};

const partialAuthFailureGuard = new Map<string, PartialAuthFailureRecord>();
const partialAuthConsumedGuard = new Map<string, number>();

function fingerprintPartialAuthToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function evictExpiredPartialAuthRecords(now: number) {
  // Cheap O(n) sweep — these maps stay small (one entry per active partial
  // token, capped by the 5-minute TTL). Run it from the read paths so we
  // don't need a separate timer.
  for (const [key, record] of partialAuthFailureGuard) {
    if (record.expiresAt <= now) partialAuthFailureGuard.delete(key);
  }
  for (const [key, expiresAt] of partialAuthConsumedGuard) {
    if (expiresAt <= now) partialAuthConsumedGuard.delete(key);
  }
}

/**
 * Returns true iff the given partial-auth token has accumulated enough
 * failed code attempts that further attempts must be refused with 429.
 * The block lasts until the token's own expiry; the token is not
 * invalidated, only throttled.
 */
export function isPartialAuthTokenBlocked(
  token: string,
  now = Date.now(),
): boolean {
  evictExpiredPartialAuthRecords(now);
  const record = partialAuthFailureGuard.get(fingerprintPartialAuthToken(token));
  if (!record) return false;
  return record.failures >= PARTIAL_AUTH_MAX_FAILURES;
}

/**
 * Records a wrong-code attempt against a partial-auth token. Stored TTL
 * tracks the token's own `expiresAtEpochSeconds` (plus a small buffer) so
 * the record self-evicts when the token would have expired anyway.
 */
export function recordPartialAuthFailure(
  token: string,
  tokenExpiresAtEpochSeconds: number,
  now = Date.now(),
) {
  const key = fingerprintPartialAuthToken(token);
  const expiresAt =
    tokenExpiresAtEpochSeconds * 1000 + PARTIAL_AUTH_GUARD_BUFFER_MS;
  const existing = partialAuthFailureGuard.get(key);
  if (!existing || existing.expiresAt <= now) {
    partialAuthFailureGuard.set(key, { failures: 1, expiresAt });
    return;
  }
  existing.failures += 1;
}

/**
 * Returns true iff this partial-auth token has already been exchanged for a
 * real session. Catches the case where an attacker captures both the partial
 * token and a fresh TOTP code, since the legitimate user's own successful
 * login burned the token.
 */
export function isPartialAuthTokenConsumed(
  token: string,
  now = Date.now(),
): boolean {
  evictExpiredPartialAuthRecords(now);
  const expiresAt = partialAuthConsumedGuard.get(
    fingerprintPartialAuthToken(token),
  );
  if (expiresAt === undefined) return false;
  return expiresAt > now;
}

export function markPartialAuthTokenConsumed(
  token: string,
  tokenExpiresAtEpochSeconds: number,
) {
  partialAuthConsumedGuard.set(
    fingerprintPartialAuthToken(token),
    tokenExpiresAtEpochSeconds * 1000 + PARTIAL_AUTH_GUARD_BUFFER_MS,
  );
}

export function _resetPartialAuthGuardsForTesting() {
  partialAuthFailureGuard.clear();
  partialAuthConsumedGuard.clear();
}
