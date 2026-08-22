import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireApiSession,
  mockGetOnboardingState,
  mockRecordOnboardingStep,
  mockFinishOnboarding,
} = vi.hoisted(() => ({
  mockRequireApiSession: vi.fn(),
  mockGetOnboardingState: vi.fn(),
  mockRecordOnboardingStep: vi.fn(),
  mockFinishOnboarding: vi.fn(),
}));

// test/setup.ts mocks this module globally so every route sees an authenticated
// session. Override it here, otherwise the unauthenticated cases silently pass
// through as signed in and assert nothing.
vi.mock("@/lib/server/modules/auth/api", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireApiSession: mockRequireApiSession,
    unauthorizedApiResponse: () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
});

vi.mock("@/lib/server/modules/onboarding/service", async () => {
  class OnboardingError extends Error {
    readonly statusCode: number;
    readonly code: string;
    constructor(code: string, message: string, statusCode: number) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  }
  return {
    OnboardingError,
    getOnboardingState: mockGetOnboardingState,
    recordOnboardingStep: mockRecordOnboardingStep,
    finishOnboarding: mockFinishOnboarding,
  };
});

import { GET as getState } from "@/app/api/v1/setup/state/route";
import { POST as postStep } from "@/app/api/v1/setup/step/route";
import { POST as postComplete } from "@/app/api/v1/setup/complete/route";
import { OnboardingError } from "@/lib/server/modules/onboarding/service";

const PENDING_STATE = {
  status: "pending",
  step: 1,
  timezone: null,
  defaultStorageRoot: null,
  completedAt: null,
};

function signedIn() {
  mockRequireApiSession.mockResolvedValue({
    session: {
      sessionId: "s1",
      userId: "u1",
      username: "ahmed",
      passwordHash: "hash",
      expiresAt: new Date(Date.now() + 60_000),
    },
    response: null,
  });
}

function signedOut() {
  mockRequireApiSession.mockResolvedValue({
    session: null,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
}

function req(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    ...(body === undefined
      ? { method: "GET" }
      : { method: "POST", body: JSON.stringify(body) }),
    headers: { cookie: "homeio_session=session-token" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
});

describe("GET /api/v1/setup/state", () => {
  it("returns 401 for unauthenticated requests", async () => {
    signedOut();

    const response = await getState(req("/api/v1/setup/state"));

    expect(response.status).toBe(401);
    expect(mockGetOnboardingState).not.toHaveBeenCalled();
  });

  it("returns the current state", async () => {
    signedIn();
    mockGetOnboardingState.mockResolvedValueOnce(PENDING_STATE);

    const response = await getState(req("/api/v1/setup/state"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: PENDING_STATE });
  });

  it("reports a read failure as 500 without leaking the error", async () => {
    signedIn();
    mockGetOnboardingState.mockRejectedValueOnce(new Error("connection terminated"));

    const response = await getState(req("/api/v1/setup/state"));
    const json = (await response.json()) as { error: string; code: string };

    expect(response.status).toBe(500);
    expect(json.code).toBe("internal_error");
    expect(json.error).not.toContain("connection terminated");
  });
});

describe("POST /api/v1/setup/step", () => {
  it("returns 401 for unauthenticated requests", async () => {
    signedOut();

    const response = await postStep(req("/api/v1/setup/step", { step: 2 }));

    expect(response.status).toBe(401);
    expect(mockRecordOnboardingStep).not.toHaveBeenCalled();
  });

  it("rejects a step outside the wizard", async () => {
    signedIn();

    const response = await postStep(req("/api/v1/setup/step", { step: 9 }));
    const json = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(json.code).toBe("validation_error");
    expect(mockRecordOnboardingStep).not.toHaveBeenCalled();
  });

  it("rejects a non-integer step", async () => {
    signedIn();

    const response = await postStep(req("/api/v1/setup/step", { step: 2.5 }));

    expect(response.status).toBe(400);
    expect(mockRecordOnboardingStep).not.toHaveBeenCalled();
  });

  it("omits fields the caller did not send so stored answers survive", async () => {
    signedIn();
    mockRecordOnboardingStep.mockResolvedValueOnce({ ...PENDING_STATE, step: 2 });

    await postStep(req("/api/v1/setup/step", { step: 2 }));

    expect(mockRecordOnboardingStep).toHaveBeenCalledWith({ step: 2 });
  });

  it("passes an explicit null through as a clear", async () => {
    signedIn();
    mockRecordOnboardingStep.mockResolvedValueOnce({ ...PENDING_STATE, step: 2 });

    await postStep(req("/api/v1/setup/step", { step: 2, timezone: null }));

    expect(mockRecordOnboardingStep).toHaveBeenCalledWith({ step: 2, timezone: null });
  });

  it("saves supplied answers and returns the new state", async () => {
    signedIn();
    const next = { ...PENDING_STATE, step: 2, timezone: "Europe/Paris" };
    mockRecordOnboardingStep.mockResolvedValueOnce(next);

    const response = await postStep(
      req("/api/v1/setup/step", { step: 2, timezone: "Europe/Paris" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: next });
  });

  it("maps a service error to its own status and code", async () => {
    signedIn();
    mockRecordOnboardingStep.mockRejectedValueOnce(
      new OnboardingError("not_pending", "Setup is not in progress", 409),
    );

    const response = await postStep(req("/api/v1/setup/step", { step: 2 }));
    const json = (await response.json()) as { error: string; code: string };

    expect(response.status).toBe(409);
    expect(json.code).toBe("not_pending");
  });
});

describe("POST /api/v1/setup/complete", () => {
  it("returns 401 for unauthenticated requests", async () => {
    signedOut();

    const response = await postComplete(req("/api/v1/setup/complete", {}));

    expect(response.status).toBe(401);
    expect(mockFinishOnboarding).not.toHaveBeenCalled();
  });

  it("completes the wizard", async () => {
    signedIn();
    const done = { ...PENDING_STATE, status: "complete", step: 5, completedAt: "2026-08-22T10:00:00.000Z" };
    mockFinishOnboarding.mockResolvedValueOnce(done);

    const response = await postComplete(req("/api/v1/setup/complete", {}));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: done });
  });

  it("is safe to call on an install that never started the wizard", async () => {
    signedIn();
    mockFinishOnboarding.mockResolvedValueOnce({ ...PENDING_STATE, status: "not_applicable" });

    const response = await postComplete(req("/api/v1/setup/complete", {}));

    expect(response.status).toBe(200);
  });
});
