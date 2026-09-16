import "server-only";

import { createHash } from "node:crypto";

/**
 * A short window during which a session may do something irreversible.
 *
 * Homeio has one account and no roles, so until now every route behind a
 * session was equally reachable: wiping a disk asked no more of a caller than
 * reading the weather. A stolen cookie, a laptop left open, or a session
 * obtained through a hole like the one in #37 could erase the machine.
 *
 * This is sudo's shape, for the same reason sudo has it. Signing in proves who
 * you are; it does not prove you meant *this*. So the destructive routes ask
 * again, and the answer is good for a few minutes rather than for the session.
 *
 * Deliberately in memory:
 *
 * - A restart drops every elevation. That is the safe direction to fail, and a
 *   restart is exactly when you least want a stale grant lying around.
 * - Nothing is written to the database, so there is no elevation record to
 *   steal, replay or forget to expire.
 */

const ELEVATION_TTL_MS = 5 * 60_000;

/**
 * Keyed on the session, not the user.
 *
 * Elevating in one browser must not quietly elevate another. Keying on the
 * user id would mean re-authenticating on a laptop grants the phone in someone
 * else's hand the same power for five minutes.
 *
 * The token is hashed rather than stored: this map would otherwise be a list of
 * live session tokens in memory, readable by anything that can read a heap
 * dump.
 */
const elevations = new Map<string, number>();

function keyFor(sessionToken: string) {
  return createHash("sha256").update(sessionToken).digest("hex");
}

function sweep(now: number) {
  for (const [key, expiresAt] of elevations) {
    if (expiresAt <= now) elevations.delete(key);
  }
}

/** Starts the window. Called only after the password has been checked again. */
export function grantElevation(sessionToken: string, now = Date.now()): number {
  sweep(now);
  const expiresAt = now + ELEVATION_TTL_MS;
  elevations.set(keyFor(sessionToken), expiresAt);
  return expiresAt;
}

export function isElevated(sessionToken: string | null | undefined, now = Date.now()): boolean {
  if (!sessionToken) return false;

  const expiresAt = elevations.get(keyFor(sessionToken));
  if (expiresAt === undefined) return false;

  if (expiresAt <= now) {
    elevations.delete(keyFor(sessionToken));
    return false;
  }

  return true;
}

/**
 * Ends the window early.
 *
 * Signing out must not leave an elevation behind for whoever signs in next on
 * the same machine, and a session that has been invalidated should take its
 * privileges with it.
 */
export function revokeElevation(sessionToken: string | null | undefined) {
  if (!sessionToken) return;
  elevations.delete(keyFor(sessionToken));
}

/** Test seam. */
export function clearAllElevations() {
  elevations.clear();
}

export { ELEVATION_TTL_MS };
