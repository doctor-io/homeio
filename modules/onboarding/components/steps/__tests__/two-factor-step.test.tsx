/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, createWrapper } from "@/test/query-client-wrapper";
import { TwoFactorStep } from "@/modules/onboarding/components/steps/two-factor-step";

const SETUP = {
  data: {
    secret: "K5RGY3TBN4XA7QW2",
    otpAuthUrl: "otpauth://totp/Homeio:ahmed?secret=K5RGY3TBN4XA7QW2",
    qrCodeSvg: '<svg viewBox="0 0 4 4"><rect width="4" height="4" /></svg>',
  },
};

const VERIFIED = {
  data: {
    enabled: true,
    enrolledAt: "2026-08-28T10:00:00.000Z",
    backupCodes: ["AAAA-1111", "BBBB-2222"],
  },
};

function renderStep(props: Record<string, unknown> = {}) {
  return render(<TwoFactorStep {...props} />, {
    wrapper: createWrapper(createTestQueryClient()),
  });
}

function mockRoutes(handlers: Record<string, { ok: boolean; body: unknown }>) {
  const fetchMock = vi.fn(async (url: string) => {
    const handler = handlers[url] ?? { ok: false, body: {} };
    return {
      ok: handler.ok,
      status: handler.ok ? 200 : 400,
      json: async () => handler.body,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("TwoFactorStep", () => {
  it("warns when the previous step just exposed the server", () => {
    mockRoutes({});
    renderStep({ isRemotelyReachable: true });

    expect(screen.getByText(/reachable beyond your LAN/)).toBeTruthy();
  });

  it("does not nag when the server is still LAN-only", () => {
    mockRoutes({});
    renderStep({ isRemotelyReachable: false });

    expect(screen.queryByText(/reachable beyond your LAN/)).toBeNull();
  });

  it("shows the QR and manual key after starting enrolment", async () => {
    mockRoutes({ "/api/v1/auth/2fa/setup": { ok: true, body: SETUP } });
    renderStep();

    fireEvent.click(screen.getByText("Set up two-factor"));

    await waitFor(() => expect(screen.getByText("K5RGY3TBN4XA7QW2")).toBeTruthy());
    expect(screen.getByLabelText("Six-digit code")).toBeTruthy();
  });

  it("only accepts six digits before confirming", async () => {
    mockRoutes({ "/api/v1/auth/2fa/setup": { ok: true, body: SETUP } });
    renderStep();

    fireEvent.click(screen.getByText("Set up two-factor"));
    await waitFor(() => expect(screen.getByLabelText("Six-digit code")).toBeTruthy());

    const input = screen.getByLabelText("Six-digit code") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12ab34" } });

    // Letters are stripped rather than rejected, so a paste from a password
    // manager still works.
    expect(input.value).toBe("1234");
    expect((screen.getByText("Turn on two-factor") as HTMLButtonElement).disabled).toBe(true);
  });

  it("reveals backup codes once and reports success", async () => {
    mockRoutes({
      "/api/v1/auth/2fa/setup": { ok: true, body: SETUP },
      "/api/v1/auth/2fa/verify": { ok: true, body: VERIFIED },
    });
    const onEnabled = vi.fn();
    renderStep({ onEnabled });

    fireEvent.click(screen.getByText("Set up two-factor"));
    await waitFor(() => expect(screen.getByLabelText("Six-digit code")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Six-digit code"), { target: { value: "482913" } });
    fireEvent.click(screen.getByText("Turn on two-factor"));

    await waitFor(() => expect(screen.getByText("Two-factor is on")).toBeTruthy());
    expect(screen.getByText("AAAA-1111")).toBeTruthy();
    expect(screen.getByText("BBBB-2222")).toBeTruthy();
    expect(onEnabled).toHaveBeenCalledTimes(1);
  });

  it("explains a rejected code in plain words and clears the field", async () => {
    mockRoutes({
      "/api/v1/auth/2fa/setup": { ok: true, body: SETUP },
      "/api/v1/auth/2fa/verify": {
        ok: false,
        body: { error: "Invalid code", code: "invalid_totp" },
      },
    });
    renderStep();

    fireEvent.click(screen.getByText("Set up two-factor"));
    await waitFor(() => expect(screen.getByLabelText("Six-digit code")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Six-digit code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByText("Turn on two-factor"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("did not match"));
    expect((screen.getByLabelText("Six-digit code") as HTMLInputElement).value).toBe("");
  });

  it("surfaces a failed enrolment start without stranding the step", async () => {
    mockRoutes({
      "/api/v1/auth/2fa/setup": {
        ok: false,
        body: { error: "Already on", code: "already_enabled" },
      },
    });
    renderStep();

    fireEvent.click(screen.getByText("Set up two-factor"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already enabled"));
    expect(screen.getByText("Set up two-factor")).toBeTruthy();
  });
});
