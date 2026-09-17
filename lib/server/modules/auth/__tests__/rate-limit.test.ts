import { afterEach, describe, expect, it } from "vitest";

import {
  _resetLoginRateLimitForTesting,
  _resetPartialAuthGuardsForTesting,
  _resetTotpReplayGuardForTesting,
  isPartialAuthTokenBlocked,
  isPartialAuthTokenConsumed,
  isTotpCodeReplayed,
  markPartialAuthTokenConsumed,
  markTotpCodeUsed,
  recordPartialAuthFailure,
  clearLoginFailures,
  getApiTokenRateLimitKey,
  getLoginRateLimitKey,
  isLoginRateLimited,
  recordLoginFailure,
} from "@/lib/server/modules/auth/rate-limit";

afterEach(() => {
  _resetTotpReplayGuardForTesting();
  _resetPartialAuthGuardsForTesting();
  _resetLoginRateLimitForTesting();
});

describe("totp replay guard", () => {
  it("returns false before any code has been marked used", () => {
    expect(isTotpCodeReplayed("user-1", "123456")).toBe(false);
  });

  it("returns true when the exact same code is replayed within the window", () => {
    markTotpCodeUsed("user-1", "123456", 1_000);
    expect(isTotpCodeReplayed("user-1", "123456", 1_500)).toBe(true);
  });

  it("returns false for a different code from the same user", () => {
    markTotpCodeUsed("user-1", "123456", 1_000);
    expect(isTotpCodeReplayed("user-1", "654321", 1_500)).toBe(false);
  });

  it("isolates the guard per user", () => {
    markTotpCodeUsed("user-1", "123456", 1_000);
    expect(isTotpCodeReplayed("user-2", "123456", 1_500)).toBe(false);
  });

  it("expires the record after its TTL elapses", () => {
    markTotpCodeUsed("user-1", "123456", 1_000);
    // 120 s TTL → record valid through 121_000 but not at 1_000 + 120_001.
    expect(isTotpCodeReplayed("user-1", "123456", 121_001)).toBe(false);
    // Calling once with an expired record should also drop it from memory.
    expect(isTotpCodeReplayed("user-1", "123456", 121_001)).toBe(false);
  });

  it("replacing the stored code with a newer one moves the window forward", () => {
    markTotpCodeUsed("user-1", "111111", 1_000);
    markTotpCodeUsed("user-1", "222222", 30_000);

    // Old code is no longer the "last used" — replay check should miss.
    expect(isTotpCodeReplayed("user-1", "111111", 30_500)).toBe(false);
    expect(isTotpCodeReplayed("user-1", "222222", 30_500)).toBe(true);
  });
});

describe("partial-auth brute-force guard", () => {
  const TOKEN = "partial.user-1.future.sig";
  // Pick an explicit `now` and a token expiry several minutes into its
  // future so we exercise the failure-count threshold without the
  // "record expired" path tripping.
  const NOW_MS = 1_000_000_000_000;
  const TOKEN_EXP_SECONDS = Math.floor(NOW_MS / 1000) + 5 * 60;

  it("returns false before any failures are recorded", () => {
    expect(isPartialAuthTokenBlocked(TOKEN, NOW_MS)).toBe(false);
  });

  it("trips at the 5th failure for the same token", () => {
    for (let i = 0; i < 4; i++) {
      recordPartialAuthFailure(TOKEN, TOKEN_EXP_SECONDS, NOW_MS);
    }
    expect(isPartialAuthTokenBlocked(TOKEN, NOW_MS)).toBe(false);

    recordPartialAuthFailure(TOKEN, TOKEN_EXP_SECONDS, NOW_MS);
    expect(isPartialAuthTokenBlocked(TOKEN, NOW_MS)).toBe(true);
  });

  it("isolates the guard per token (different raw tokens cannot pool)", () => {
    for (let i = 0; i < 5; i++) {
      recordPartialAuthFailure(TOKEN, TOKEN_EXP_SECONDS, NOW_MS);
    }
    expect(isPartialAuthTokenBlocked(TOKEN, NOW_MS)).toBe(true);
    expect(
      isPartialAuthTokenBlocked("partial.other.future.sig", NOW_MS),
    ).toBe(false);
  });

  it("self-evicts once the token's own expiry has passed", () => {
    for (let i = 0; i < 5; i++) {
      recordPartialAuthFailure(TOKEN, TOKEN_EXP_SECONDS, NOW_MS);
    }
    expect(isPartialAuthTokenBlocked(TOKEN, NOW_MS)).toBe(true);

    // After expiry + buffer: the read-path sweep drops the record and the
    // block disappears. Real-world equivalent: token has expired anyway, so
    // the caller would already see partial_auth_expired before this check.
    const wellPastExpiry = TOKEN_EXP_SECONDS * 1000 + 60_000;
    expect(isPartialAuthTokenBlocked(TOKEN, wellPastExpiry)).toBe(false);
  });
});

describe("partial-auth single-use guard", () => {
  const TOKEN = "partial.user-1.future.sig";
  // Use a real "near-future" epoch for these tests since they don't pass an
  // explicit `now` and the default Date.now() must not have already passed
  // the token's expiry.
  const TOKEN_EXP_SECONDS = Math.floor(Date.now() / 1000) + 60 * 60;

  it("returns false before the token has been consumed", () => {
    expect(isPartialAuthTokenConsumed(TOKEN)).toBe(false);
  });

  it("returns true after markPartialAuthTokenConsumed", () => {
    markPartialAuthTokenConsumed(TOKEN, TOKEN_EXP_SECONDS);
    expect(isPartialAuthTokenConsumed(TOKEN)).toBe(true);
  });

  it("isolates per token", () => {
    markPartialAuthTokenConsumed(TOKEN, TOKEN_EXP_SECONDS);
    expect(isPartialAuthTokenConsumed("partial.other.future.sig")).toBe(false);
  });

  it("clears once the token's own expiry has passed", () => {
    markPartialAuthTokenConsumed(TOKEN, TOKEN_EXP_SECONDS);
    expect(isPartialAuthTokenConsumed(TOKEN)).toBe(true);

    const wellPastExpiry = TOKEN_EXP_SECONDS * 1000 + 60_000;
    expect(isPartialAuthTokenConsumed(TOKEN, wellPastExpiry)).toBe(false);
  });
});

describe("per-identity lockout (D-6)", () => {
  function requestFrom(ip: string) {
    return new Request("https://homeio.test/api/v1/apps", {
      headers: { "x-forwarded-for": ip },
    });
  }

  it("does not lock a token because other tokens were guessed at", () => {
    // The measurement that found this: a token never attacked answered 429
    // after ten wrong guesses aimed at two other tokens. Every token shared one
    // bucket, because the key "token:<prefix>:<ip>" was split on ":" to recover
    // the identity and gave the literal "token".
    const attacked = ["homeio_AAAAAAAA", "homeio_BBBBBBBB"];
    for (const prefix of attacked) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        recordLoginFailure(getApiTokenRateLimitKey(requestFrom("10.0.0.9"), prefix));
      }
    }

    const untouched = getApiTokenRateLimitKey(requestFrom("10.0.0.9"), "homeio_CCCCCCCC");
    expect(isLoginRateLimited(untouched)).toBe(false);
  });

  it("still locks the token that was actually guessed at", () => {
    const key = getApiTokenRateLimitKey(requestFrom("10.0.0.9"), "homeio_DDDDDDDD");
    for (let attempt = 0; attempt < 5; attempt += 1) recordLoginFailure(key);

    expect(isLoginRateLimited(key)).toBe(true);
  });

  it("does not let one token's success clear another token's failures", () => {
    // The second consequence: any success emptied the shared bucket, so the
    // distributed-attack protection was decorative for tokens.
    //
    // Spread over addresses so no single source bucket trips on its own. What
    // holds the lockout here is the identity-level counter — the one another
    // token used to be able to empty.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      recordLoginFailure(
        getApiTokenRateLimitKey(requestFrom(`10.0.2.${attempt}`), "homeio_EEEEEEEE"),
      );
    }
    const victim = getApiTokenRateLimitKey(requestFrom("10.0.3.1"), "homeio_EEEEEEEE");
    expect(isLoginRateLimited(victim)).toBe(true);

    clearLoginFailures(getApiTokenRateLimitKey(requestFrom("10.0.3.1"), "homeio_FFFFFFFF"));

    expect(isLoginRateLimited(victim)).toBe(true);
  });

  it("keeps two prefixes that differ only in case apart", () => {
    // Tokens are base64url, so case identifies. A username is lowercased; a
    // prefix must not be, or two tokens become one bucket. Spread over
    // addresses again, so it is the identity that is being measured.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      recordLoginFailure(
        getApiTokenRateLimitKey(requestFrom(`10.0.4.${attempt}`), "homeio_ABCDEFGH"),
      );
    }

    expect(
      isLoginRateLimited(getApiTokenRateLimitKey(requestFrom("10.0.5.1"), "homeio_ABCDEFGH")),
    ).toBe(true);
    expect(
      isLoginRateLimited(getApiTokenRateLimitKey(requestFrom("10.0.5.1"), "homeio_abcdefgh")),
    ).toBe(false);
  });

  it("locks a user across source addresses once the identity-level count trips", () => {
    // The protection that was meant to exist: ten failures spread over many
    // addresses, each under the per-source limit of five.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      recordLoginFailure(getLoginRateLimitKey(requestFrom(`10.0.0.${attempt}`), "ahmed"));
    }

    expect(isLoginRateLimited(getLoginRateLimitKey(requestFrom("10.0.1.1"), "ahmed"))).toBe(true);
    expect(isLoginRateLimited(getLoginRateLimitKey(requestFrom("10.0.1.1"), "someone-else"))).toBe(false);
  });
});
