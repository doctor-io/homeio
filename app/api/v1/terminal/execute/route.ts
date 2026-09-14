import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import {
  executeTerminalCommand,
  TerminalServiceError,
} from "@/lib/server/modules/terminal/service";

export const runtime = "nodejs";

// ── In-memory rate limiter ───────────────────────────────────────────────────
// Allows up to RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW_MS per client IP.
// The store is module-level so it persists across requests within a server
// process but resets on server restart (acceptable for a home-server dashboard).
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

type RateLimitEntry = { count: number; resetAt: number };
const rateLimitStore = new Map<string, RateLimitEntry>();

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "loopback";
}

/** Returns true if the request should be blocked (limit exceeded). */
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  const rateLimitKey = `${apiSession.session.userId}:${getClientIp(request)}`;
  if (isRateLimited(rateLimitKey)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before sending more commands.", code: "rate_limited" },
      { status: 429 },
    );
  }

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "terminal.execute.post",
        requestId,
      },
      async () => {
        const payload = await request.json();
        const data = await executeTerminalCommand(payload, {
          requestId,
        });

        return NextResponse.json({
          data,
        });
      },
    );
  } catch (error) {
    if (error instanceof TerminalServiceError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
        },
        {
          status: error.statusCode,
        },
      );
    }

    logServerAction({
      level: "error",
      layer: "api",
      action: "terminal.execute.post.response",
      status: "error",
      requestId,
      message: "Unable to execute terminal command",
      error,
    });

    return NextResponse.json(
      {
        error: "Unable to execute terminal command",
        code: "internal_error",
      },
      {
        status: 500,
      },
    );
  }
}
