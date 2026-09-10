import "server-only";

import { and, count, eq, gt } from "drizzle-orm";
import { db } from "@/lib/server/db/drizzle";
import { sessions, users } from "@/lib/server/db/schema";

export type AuthUser = {
  id: string;
  username: string;
  passwordHash: string;
};

export type AuthUserWithTotp = AuthUser & {
  totpSecret: string | null;
  totpEnabled: boolean;
  totpBackupCodes: string | null;
  totpEnrolledAt: Date | null;
  tourSeenAt: Date | null;
};

export type AuthSessionWithUser = {
  sessionId: string;
  userId: string;
  username: string;
  passwordHash: string;
  expiresAt: Date;
};

export async function findUserByUsername(username: string) {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return row satisfies AuthUser;
}

/**
 * Like {@link findUserByUsername} but also pulls the TOTP columns. Used by
 * the login flow so a single DB round-trip can both verify the password
 * and decide whether to issue a real session or a partial-auth token.
 */
export async function findUserWithTotpByUsername(
  username: string,
): Promise<AuthUserWithTotp | null> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      passwordHash: users.passwordHash,
      totpSecret: users.totpSecret,
      totpEnabled: users.totpEnabled,
      totpBackupCodes: users.totpBackupCodes,
      totpEnrolledAt: users.totpEnrolledAt,
      tourSeenAt: users.tourSeenAt,
    })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    totpSecret: row.totpSecret,
    totpEnabled: row.totpEnabled,
    totpBackupCodes: row.totpBackupCodes,
    totpEnrolledAt:
      row.totpEnrolledAt instanceof Date || row.totpEnrolledAt === null
        ? row.totpEnrolledAt
        : new Date(row.totpEnrolledAt),
    tourSeenAt:
      row.tourSeenAt instanceof Date || row.tourSeenAt === null
        ? row.tourSeenAt
        : new Date(row.tourSeenAt),
  } satisfies AuthUserWithTotp;
}

export async function hasAnyUsers() {
  const result = await db.select({ total: count() }).from(users).limit(1);
  return (result[0]?.total ?? 0) > 0;
}

export async function createUser(params: {
  id: string;
  username: string;
  passwordHash: string;
}) {
  await db.insert(users).values({
    id: params.id,
    username: params.username,
    passwordHash: params.passwordHash,
  });
}

export async function findUserWithTotpById(
  userId: string,
): Promise<AuthUserWithTotp | null> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      passwordHash: users.passwordHash,
      totpSecret: users.totpSecret,
      totpEnabled: users.totpEnabled,
      totpBackupCodes: users.totpBackupCodes,
      totpEnrolledAt: users.totpEnrolledAt,
      tourSeenAt: users.tourSeenAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    totpSecret: row.totpSecret,
    totpEnabled: row.totpEnabled,
    totpBackupCodes: row.totpBackupCodes,
    totpEnrolledAt:
      row.totpEnrolledAt instanceof Date || row.totpEnrolledAt === null
        ? row.totpEnrolledAt
        : new Date(row.totpEnrolledAt),
    tourSeenAt:
      row.tourSeenAt instanceof Date || row.tourSeenAt === null
        ? row.tourSeenAt
        : new Date(row.tourSeenAt),
  } satisfies AuthUserWithTotp;
}

/**
 * Persists a freshly-generated (but not yet confirmed) TOTP secret on the
 * user row. Refuses to overwrite if `totp_enabled` is already true — the
 * caller must disable first. Returns true iff the row was updated; callers
 * should treat false as "already enrolled" to close the setup race where
 * two concurrent /setup calls both pass the in-memory check.
 */
export async function setPendingTotpSecret(
  userId: string,
  encryptedSecret: string,
): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ totpSecret: encryptedSecret })
    .where(and(eq(users.id, userId), eq(users.totpEnabled, false)))
    .returning({ id: users.id });
  return result.length === 1;
}

/**
 * Flips the user from "secret stored, awaiting first valid code" to fully
 * enrolled. Conditional on `totp_enabled = false` so that two near-
 * simultaneous /verify calls cannot both succeed and overwrite each other's
 * backup-code blob — the second one returns false and the service maps it
 * to `already_enabled`. Returns true iff the row was updated.
 */
export async function completeTotpEnrollment(params: {
  userId: string;
  encryptedBackupCodes: string;
  enrolledAt: Date;
}): Promise<boolean> {
  const result = await db
    .update(users)
    .set({
      totpEnabled: true,
      totpBackupCodes: params.encryptedBackupCodes,
      totpEnrolledAt: params.enrolledAt,
    })
    .where(and(eq(users.id, params.userId), eq(users.totpEnabled, false)))
    .returning({ id: users.id });
  return result.length === 1;
}

/**
 * Compare-and-swap update of the encrypted backup-codes blob. Closes the
 * race where two concurrent /login/totp calls with different backup codes
 * read the same blob and write back interleaved versions — without the
 * CAS, the second writer would lose the first's consumption and the same
 * code could be used twice. Returns true iff the previous value matched.
 */
export async function updateTotpBackupCodes(params: {
  userId: string;
  previousBackupCodes: string;
  nextBackupCodes: string;
}): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ totpBackupCodes: params.nextBackupCodes })
    .where(
      and(
        eq(users.id, params.userId),
        eq(users.totpBackupCodes, params.previousBackupCodes),
      ),
    )
    .returning({ id: users.id });
  return result.length === 1;
}

/**
 * Reverses {@link completeTotpEnrollment} in a single statement: drops the
 * secret, backup codes, enrolment timestamp, and flips `totp_enabled` off.
 * Used by the disable flow once the user has proven possession with a valid
 * TOTP or backup code.
 */
export async function clearTotpEnrollment(userId: string) {
  await db
    .update(users)
    .set({
      totpSecret: null,
      totpEnabled: false,
      totpBackupCodes: null,
      totpEnrolledAt: null,
    })
    .where(eq(users.id, userId));
}

export async function createSession(params: {
  id: string;
  userId: string;
  expiresAt: Date;
}) {
  await db.insert(sessions).values({
    id: params.id,
    userId: params.userId,
    expiresAt: params.expiresAt,
  });
}

export async function deleteSessionById(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Wipes every session row belonging to a user. Called from the /2fa/disable
 * flow so that disabling a second factor immediately revokes every active
 * device — a passive attacker who captured a session cookie pre-disable
 * cannot ride the disable through.
 */
export async function deleteSessionsForUser(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function findSessionWithUser(sessionId: string) {
  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      username: users.username,
      passwordHash: users.passwordHash,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    username: row.username,
    passwordHash: row.passwordHash,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt),
  } satisfies AuthSessionWithUser;
}

/** Record that this account has been shown the desktop tour. */
export async function markTourSeen(userId: string) {
  await db.update(users).set({ tourSeenAt: new Date() }).where(eq(users.id, userId));
}
