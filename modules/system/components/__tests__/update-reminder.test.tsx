/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemUpdateStatus } from "@/lib/shared/contracts/system";
import { UPDATE_REMINDER_SNOOZE_MS } from "@/lib/desktop/update-reminder";
import {
  DEFAULT_DESKTOP_PREFERENCES,
  DESKTOP_PREFERENCES_STORAGE_KEY,
} from "@/lib/desktop/preferences";

const { statusRef, applyMock, persistMock } = vi.hoisted(() => ({
  statusRef: { current: undefined as SystemUpdateStatus | undefined },
  applyMock: vi.fn(),
  persistMock: vi.fn(),
}));

vi.mock("@/modules/system/hooks/useSystemUpdateStatus", () => ({
  useSystemUpdateStatus: () => ({ data: statusRef.current }),
}));

vi.mock("@/modules/settings/hooks/backend/api", () => ({
  applySystemUpdateRequest: applyMock,
}));

vi.mock("@/modules/settings/hooks/useUpdateRecoveryState", () => ({
  persistPowerActionState: persistMock,
}));

import { UpdateReminder } from "@/modules/system/components/update-reminder";

function updateStatus(overrides: Partial<SystemUpdateStatus> = {}): SystemUpdateStatus {
  return {
    currentVersion: "1.10.0",
    latestVersion: "1.10.1",
    updateAvailable: true,
    checkedAt: "2026-09-27T10:00:00.000Z",
    canSelfUpdate: true,
    ...overrides,
  };
}

describe("UpdateReminder", () => {
  beforeEach(() => {
    window.localStorage.clear();
    statusRef.current = updateStatus();
    applyMock.mockReset();
    persistMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the new and current version while an update is available", async () => {
    render(<UpdateReminder enabled onOpenDetails={vi.fn()} />);

    const bar = await screen.findByRole("status", { name: "Homeio update available" });
    expect(bar.textContent).toContain("Homeio 1.10.1 is available");
    expect(bar.textContent).toContain("You have 1.10.0");
    expect(screen.getByRole("button", { name: "Update now" })).toBeTruthy();
  });

  it("stays hidden when there is no update, when disabled, or when update notifications are off", async () => {
    statusRef.current = updateStatus({ updateAvailable: false });
    const { rerender } = render(<UpdateReminder enabled onOpenDetails={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

    statusRef.current = updateStatus();
    rerender(<UpdateReminder enabled={false} onOpenDetails={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("respects the existing update notifications preference", async () => {
    window.localStorage.setItem(
      DESKTOP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_DESKTOP_PREFERENCES,
        notifications: {
          ...DEFAULT_DESKTOP_PREFERENCES.notifications,
          updateNotificationsEnabled: false,
        },
      }),
    );
    render(<UpdateReminder enabled onOpenDetails={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("hides on Later and comes back an hour later without a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<UpdateReminder enabled onOpenDetails={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(UPDATE_REMINDER_SNOOZE_MS - 1_000);
    });
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByRole("status", { name: "Homeio update available" })).toBeTruthy();
  });

  it("keeps the snooze across a reload but shows a newer version straight away", async () => {
    const first = render(<UpdateReminder enabled onOpenDetails={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    first.unmount();

    const second = render(<UpdateReminder enabled onOpenDetails={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    second.unmount();

    statusRef.current = updateStatus({ latestVersion: "1.10.2" });
    render(<UpdateReminder enabled onOpenDetails={vi.fn()} />);
    expect((await screen.findByRole("status")).textContent).toContain("1.10.2");
  });

  it("opens the details and shows the Docker command instead of Update now in the container", async () => {
    statusRef.current = updateStatus({ canSelfUpdate: false });
    const onOpenDetails = vi.fn();
    render(<UpdateReminder enabled onOpenDetails={onOpenDetails} />);

    const bar = await screen.findByRole("status");
    expect(screen.queryByRole("button", { name: "Update now" })).toBeNull();
    expect(bar.textContent).toContain("docker compose pull && docker compose up -d");

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(onOpenDetails).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the error and keeps the bar when the update cannot start", async () => {
    applyMock.mockRejectedValueOnce(new Error("Failed to schedule Homeio update"));
    render(<UpdateReminder enabled onOpenDetails={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));

    expect(await screen.findByText("Failed to schedule Homeio update")).toBeTruthy();
    expect(persistMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Update now" })).toBeTruthy();
  });

  it("hands off to the updating screen like Settings does", async () => {
    applyMock.mockResolvedValueOnce({ action: "update", accepted: true });
    const replace = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, replace },
    });

    try {
      render(<UpdateReminder enabled onOpenDetails={vi.fn()} />);
      fireEvent.click(await screen.findByRole("button", { name: "Update now" }));

      await waitFor(() => expect(replace).toHaveBeenCalledWith("/updating"));
      expect(applyMock).toHaveBeenCalledWith("1.10.1");
      expect(persistMock).toHaveBeenCalledWith(
        "update",
        expect.objectContaining({ requestDispatchedAt: expect.any(String) }),
      );
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });
});
