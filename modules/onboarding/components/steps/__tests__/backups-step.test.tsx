/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackupsStep } from "@/modules/onboarding/components/steps/backups-step";

describe("BackupsStep", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  it("schedules a real backup task rather than only looking like it did", async () => {
    const onScheduledChange = vi.fn();
    render(<BackupsStep onScheduledChange={onScheduledChange} />);

    fireEvent.click(screen.getByText("Schedule it"));

    await waitFor(() => expect(onScheduledChange).toHaveBeenCalledWith(true));

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/v1/scheduled-tasks");
    expect(JSON.parse(String(init.body))).toMatchObject({
      taskType: "backup",
      taskConfig: { type: "backup" },
      cronExpression: "0 3 * * *",
      enabled: true,
    });
  });

  it("keeps the step usable when the task cannot be created", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "nope" }) }),
    );
    const onScheduledChange = vi.fn();
    render(<BackupsStep onScheduledChange={onScheduledChange} />);

    fireEvent.click(screen.getByText("Schedule it"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("nope"));
    // Claiming success on a failed write would leave the operator with no backup
    // and no reason to look.
    expect(onScheduledChange).not.toHaveBeenCalled();
  });
});
