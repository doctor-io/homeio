import "server-only";

import { randomUUID } from "node:crypto";
import { serverEnv } from "@/lib/server/env";
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

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Equal-time defence for the user-not-found branch of {@link loginUser}.
 * Without this, the response time on an unknown username is noticeably
 * shorter (one DB miss, no scrypt) than on a known one (DB hit plus a full
 * password verification), letting an attacker enumerate valid usernames.
 *
 * Computed once at module load so first-call latency stays in line with
 * subsequent calls; the verifyPassword on the miss path then re-runs scrypt
 * against this fixed hash for the same shape of work as a real check.
 */
const DUMMY_PASSWORD_HASH_PROMISE: Promise<string> = hashPassword(
  "__nonexistent_user_password__",
);
DUMMY_PASSWORD_HASH_PROMISE.catch(() => {
  // Swallow to prevent an unhandled rejection if scrypt ever throws at
  // import time; loginUser awaits the same promise and will surface it.
});

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function validateUsername(username: string) {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9_-]{3,32}$/.test(normalized)) {
    throw new AuthError(
      "Username must be 3-32 chars and use only lowercase letters, numbers, underscore, or dash",
      400,
    );
  }

  return normalized;
}

function validatePassword(password: string) {
  if (password.length < 8) {
    throw new AuthError("Password must be at least 8 characters", 400);
  }
}

function getSessionExpiryDate() {
  return new Date(Date.now() + serverEnv.AUTH_SESSION_HOURS * 60 * 60 * 1000);
}

export async function registerUser(params: {
  username: string;
  password: string;
  confirmPassword: string;
}) {
  const username = validateUsername(params.username);
  validatePassword(params.password);

  if (params.password !== params.confirmPassword) {
    throw new AuthError("Password confirmation does not match", 400);
  }

  const existingUser = await findUserByUsername(username);
  if (existingUser) {
    throw new AuthError("Username is already registered", 409);
  }

  const userId = randomUUID();
  const passwordHash = await hashPassword(params.password);

  await createUser({
    id: userId,
    username,
    passwordHash,
  });

  return {
    id: userId,
    username,
  };
}

export type LoginResult =
  | {
      kind: "session";
      token: string;
      expiresAt: Date;
      user: { id: string; username: string };
    }
  | {
      kind: "partial";
      partialAuthToken: string;
      partialAuthExpiresAt: Date;
      user: { id: string; username: string };
    };

/**
 * Issue a session for a user who has already been authenticated. Registration
 * uses it too: making someone sign in again immediately after choosing their
 * password asks for the same secret twice before they have seen anything.
 */
export async function startSession(user: { id: string; username: string }) {
  const expiresAt = getSessionExpiryDate();
  const sessionId = randomUUID();

  await createSession({ id: sessionId, userId: user.id, expiresAt });

  return {
    token: createSessionToken(sessionId, Math.floor(expiresAt.getTime() / 1000)),
    expiresAt,
    user: { id: user.id, username: user.username },
  };
}

export async function loginUser(params: {
  username: string;
  password: string;
}): Promise<LoginResult> {
  const username = normalizeUsername(params.username);

  const user = await findUserWithTotpByUsername(username);

  if (!user) {
    // Run a full scrypt verification against a fixed dummy hash so the miss
    // path takes the same wall-clock time as the user-exists / wrong-password
    // path. Without this the timing delta leaks username existence.
    const dummyHash = await DUMMY_PASSWORD_HASH_PROMISE;
    await verifyPassword(params.password, dummyHash);
    throw new AuthError("Invalid username or password", 401);
  }

  const isPasswordValid = await verifyPassword(params.password, user.passwordHash);

  if (!isPasswordValid) {
    throw new AuthError("Invalid username or password", 401);
  }

  if (user.totpEnabled) {
    // Password verified but the user has 2FA on — issue a stateless,
    // short-lived partial-auth token instead of a full session. The caller
    // must complete A8 to convert it into a real session cookie.
    const { token, expiresAtEpochSeconds } = createPartialAuthToken(user.id);
    return {
      kind: "partial",
      partialAuthToken: token,
      partialAuthExpiresAt: new Date(expiresAtEpochSeconds * 1000),
      user: {
        id: user.id,
        username: user.username,
      },
    };
  }

  const session = await startSession(user);

  return {
    kind: "session",
    token: session.token,
    expiresAt: session.expiresAt,
    user: session.user,
  };
}

export async function logoutSession(sessionToken: string | null | undefined) {
  if (!sessionToken) return;

  const verified = verifySessionToken(sessionToken);
  if (!verified) return;

  await deleteSessionById(verified.sessionId);
}

export async function authenticateSession(sessionToken: string | null | undefined) {
  if (!sessionToken) return null;

  const verified = verifySessionToken(sessionToken);
  if (!verified) return null;

  const session = await findSessionWithUser(verified.sessionId);
  if (!session) return null;

  return {
    sessionId: session.sessionId,
    userId: session.userId,
    username: session.username,
    passwordHash: session.passwordHash,
    expiresAt: session.expiresAt,
  };
}

export async function verifyUnlockPassword(params: {
  sessionToken: string | null | undefined;
  password: string;
}) {
  const session = await authenticateSession(params.sessionToken);
  if (!session) {
    throw new AuthError("Unauthorized", 401);
  }

  const isPasswordValid = await verifyPassword(
    params.password,
    session.passwordHash,
  );

  if (!isPasswordValid) {
    throw new AuthError("Invalid password", 401);
  }

  return {
    userId: session.userId,
    username: session.username,
  };
}
