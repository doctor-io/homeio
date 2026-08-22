import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockRedirect, mockGetOnboardingState } = vi.hoisted(() => ({
  mockRedirect: vi.fn((path: string) => {
    // Next's redirect() signals by throwing; mirror that so the code under test
    // stops at the redirect exactly like it does at runtime.
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${path}` });
  }),
  mockGetOnboardingState: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/server/modules/onboarding/service", () => ({
  getOnboardingState: mockGetOnboardingState,
}));
vi.mock("@/modules/shell/components/desktop-shell", () => ({
  DesktopShell: () => null,
}));
vi.mock("@/modules/shell/components/full-screen-shell", () => ({
  FullScreenShell: () => null,
}));
vi.mock("@/components/providers/realtime-bootstrap", () => ({
  RealtimeBootstrap: () => null,
}));
vi.mock("@/modules/onboarding/components/setup-wizard", () => ({
  SetupWizard: () => null,
}));

import HomePage from "@/app/page";
import SetupPage from "@/app/setup/page";

function state(status: string) {
  return { status, step: 1, timezone: null, defaultStorageRoot: null, completedAt: null };
}

async function redirectTargetOf(page: () => Promise<unknown>) {
  try {
    await page();
    return null;
  } catch (error) {
    const digest = (error as { digest?: string }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) {
      return digest.slice("NEXT_REDIRECT;".length);
    }
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("home page setup gate", () => {
  it("sends a pending install to the wizard", async () => {
    mockGetOnboardingState.mockResolvedValueOnce(state("pending"));

    await expect(redirectTargetOf(HomePage)).resolves.toBe("/setup");
  });

  it("lets a completed install through to the desktop", async () => {
    mockGetOnboardingState.mockResolvedValueOnce(state("complete"));

    await expect(redirectTargetOf(HomePage)).resolves.toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("lets an install that predates the wizard through to the desktop", async () => {
    mockGetOnboardingState.mockResolvedValueOnce(state("not_applicable"));

    await expect(redirectTargetOf(HomePage)).resolves.toBeNull();
  });

  it("falls through to the desktop when the state read fails", async () => {
    // A database hiccup must never lock someone out of their own server.
    mockGetOnboardingState.mockRejectedValueOnce(new Error("connection terminated"));

    await expect(redirectTargetOf(HomePage)).resolves.toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("setup page guard", () => {
  it("renders the wizard while setup is pending", async () => {
    mockGetOnboardingState.mockResolvedValueOnce(state("pending"));

    await expect(redirectTargetOf(SetupPage)).resolves.toBeNull();
  });

  it("bounces a completed install back to the desktop", async () => {
    mockGetOnboardingState.mockResolvedValueOnce(state("complete"));

    await expect(redirectTargetOf(SetupPage)).resolves.toBe("/");
  });

  it("bounces an install that predates the wizard back to the desktop", async () => {
    mockGetOnboardingState.mockResolvedValueOnce(state("not_applicable"));

    await expect(redirectTargetOf(SetupPage)).resolves.toBe("/");
  });

  it("bounces to the desktop when the state read fails", async () => {
    mockGetOnboardingState.mockRejectedValueOnce(new Error("connection terminated"));

    await expect(redirectTargetOf(SetupPage)).resolves.toBe("/");
  });
});
