import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { API_TOKEN_SCOPES } from "@/lib/shared/contracts/api-tokens";

const publicRoutes = new Set([
  "files/google-drive/auth/route.ts",
  "files/google-drive/callback/route.ts",
  // A8: second step of two-factor login. The caller has a valid partial-auth
  // token (issued by /api/auth/login) but no session yet — that's the whole
  // reason this endpoint exists.
  "auth/login/totp/route.ts",
  // M4: a phone spending a pairing code has no session yet — that is what it
  // is asking for. This is the first addition to this list since v1.7, and it
  // was a deliberate decision rather than an oversight: the alternative QR
  // designs (address only, or address plus username) need no new route at all.
  // What keeps it narrow — a 256-bit code, single use enforced by a conditional
  // UPDATE, dead after 60 seconds, mintable only by an operator who is already
  // signed in, and rate limited on the login limiter.
  "auth/pairing/claim/route.ts",
]);

function findRouteFiles(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return findRouteFiles(entryPath, root);
    }

    if (entry.name !== "route.ts") return [];
    return [path.relative(root, entryPath)];
  });
}

describe("api v1 auth architecture", () => {
  it("requires the shared API session helper on every non-public route", () => {
    const apiRoot = path.join(process.cwd(), "app/api/v1");
    const missingAuth = findRouteFiles(apiRoot)
      .filter((file) => !publicRoutes.has(file))
      .filter((file) => {
        const content = readFileSync(path.join(apiRoot, file), "utf8");
        // `requireElevatedSession` is `requireApiSession` plus a re-auth check,
        // so a route using it is authenticated by a stricter rule, not a
        // different one. See elevation-architecture.test.ts for which routes
        // are expected to reach for it.
        return (
          !content.includes("requireApiSession") &&
          !content.includes("requireElevatedSession")
        );
      });

    expect(missingAuth).toEqual([]);
  });

  it("accepts a scoped route as authenticated, since bearer auth runs inside the helper", () => {
    // Token support did not add a second way in: requireApiSession handles both
    // credentials, so a scoped route satisfies the rule above unchanged. This
    // pins that, so nobody "fixes" the guard by special-casing scopes.
    const apiRoot = path.join(process.cwd(), "app/api/v1");
    const scoped = findRouteFiles(apiRoot).filter((file) =>
      /requireApiSession\(\s*request\s*,\s*\{\s*scope:/.test(
        readFileSync(path.join(apiRoot, file), "utf8"),
      ),
    );

    expect(scoped.length).toBeGreaterThan(0);
    for (const file of scoped) {
      expect(readFileSync(path.join(apiRoot, file), "utf8")).toContain("requireApiSession");
    }
  });

  it("never lets a route be both public and token-scoped", () => {
    // A public route needs no credential at all, so granting it a scope would
    // be meaningless — and would suggest a protection that is not there.
    const apiRoot = path.join(process.cwd(), "app/api/v1");
    const contradictions = [...publicRoutes].filter((file) => {
      try {
        return /requireApiSession\(\s*request\s*,\s*\{\s*scope:/.test(
          readFileSync(path.join(apiRoot, file), "utf8"),
        );
      } catch {
        return false;
      }
    });

    expect(contradictions).toEqual([]);
  });

  it("only names scopes that exist", () => {
    const apiRoot = path.join(process.cwd(), "app/api/v1");
    const used = findRouteFiles(apiRoot)
      .map((file) =>
        readFileSync(path.join(apiRoot, file), "utf8").match(
          /requireApiSession\(\s*request\s*,\s*\{\s*scope:\s*"([^"]+)"/,
        )?.[1],
      )
      .filter((scope): scope is string => Boolean(scope));

    const unknown = used.filter(
      (scope) => !(API_TOKEN_SCOPES as readonly string[]).includes(scope),
    );

    expect(unknown).toEqual([]);
  });
});
