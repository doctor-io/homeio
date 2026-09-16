import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Which routes may do something that cannot be undone, and what they ask for.
 *
 * Homeio has one account and no roles, so before elevation existed every route
 * behind a session was equally reachable: erasing a disk asked no more of a
 * caller than reading the weather. A stolen cookie or a session obtained
 * through a hole like #37 was enough to destroy the machine.
 *
 * This file is the list, and the list is the decision. A new route that wipes
 * something has to appear here, which means someone has to think about it.
 */

const API_ROOT = path.join(process.cwd(), "app", "api", "v1");

/** Nothing brings back what these do. */
const IRREVERSIBLE_ROUTES = [
  "system/disks/wipe",
  "system/disks/format",
  "system/disks/delete-partition",
  "system/power/factory-reset",
  "system/backups/[backupId]/restore",
] as const;

async function readRoute(route: string) {
  return readFile(path.join(API_ROOT, ...route.split("/"), "route.ts"), "utf8");
}

describe("elevation", () => {
  it.each(IRREVERSIBLE_ROUTES)("%s requires the password again", async (route) => {
    const source = await readRoute(route);

    expect(source).toContain("requireElevatedSession");
    // Not both: a route that still calls the plain guard somewhere has a path
    // through it that skips the question.
    expect(source).not.toMatch(/\brequireApiSession\b/);
  });

  it("closes these routes to API tokens as a consequence, not by accident", async () => {
    for (const route of IRREVERSIBLE_ROUTES) {
      const source = await readRoute(route);

      // A token is a stored credential; it cannot be asked for a password. So
      // naming a scope here would be a contradiction — the route would claim
      // to accept a caller that can never satisfy it.
      expect(source, `${route} should not name a token scope`).not.toMatch(/scope:\s*"/);
    }
  });

  it("asks for it again after the window closes", async () => {
    const { clearAllElevations, grantElevation, isElevated, ELEVATION_TTL_MS } = await import(
      "@/lib/server/modules/auth/elevation"
    );

    clearAllElevations();
    const now = Date.now();
    grantElevation("session-token", now);

    expect(isElevated("session-token", now + 1_000)).toBe(true);
    expect(isElevated("session-token", now + ELEVATION_TTL_MS + 1)).toBe(false);
  });

  it("elevates one session, not one user", async () => {
    const { clearAllElevations, grantElevation, isElevated } = await import(
      "@/lib/server/modules/auth/elevation"
    );

    clearAllElevations();
    grantElevation("laptop-session");

    // Same account, different device. Re-authenticating on the laptop must not
    // hand the phone in someone else's hand five minutes of the same power.
    expect(isElevated("laptop-session")).toBe(true);
    expect(isElevated("phone-session")).toBe(false);
  });

  it("loses every grant when the process restarts", async () => {
    const { grantElevation, isElevated, clearAllElevations } = await import(
      "@/lib/server/modules/auth/elevation"
    );
    clearAllElevations();
    grantElevation("session-token");
    expect(isElevated("session-token")).toBe(true);

    // A fresh module instance is what a restart leaves behind: the Map is
    // module state, so re-importing it is the same emptiness systemd produces.
    vi.resetModules();
    const restarted = await import("@/lib/server/modules/auth/elevation");

    expect(restarted.isElevated("session-token")).toBe(false);
  });

  it("keeps grants nowhere a restart could not clear", async () => {
    // The comment in elevation.ts says in memory and only in memory. This is
    // what stops that from being a comment. Persisting elevation is a plausible
    // "fix" for the prompt coming back after a deploy, and it would trade a
    // five-minute window for a grant a restart can no longer revoke.
    const source = await readFile(
      path.join(process.cwd(), "lib", "server", "modules", "auth", "elevation.ts"),
      "utf8",
    );

    for (const forbidden of ["/db", "drizzle", "node:fs", "redis", "localStorage"]) {
      expect(source, `elevation must not reach for ${forbidden}`).not.toContain(
        `from "${forbidden}`,
      );
    }
    expect(source).not.toMatch(/\bfrom "[^"]*\/db\//);
  });

  it("drops the grant when the session ends", async () => {
    const { clearAllElevations, grantElevation, isElevated, revokeElevation } = await import(
      "@/lib/server/modules/auth/elevation"
    );

    clearAllElevations();
    grantElevation("session-token");
    revokeElevation("session-token");

    expect(isElevated("session-token")).toBe(false);
  });
});
