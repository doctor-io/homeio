/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposeRiskNotice } from "@/modules/apps/components/configurator/compose-risk-notice";

const RISKS = [
  { code: "privileged", service: "agent", detail: "Runs privileged — full root access to the host kernel" },
  { code: "docker_socket", service: "agent", detail: "Mounts the Docker socket — equivalent to root on the host" },
];

describe("ComposeRiskNotice", () => {
  it("lists every risk with the service it came from", () => {
    render(<ComposeRiskNotice risks={RISKS} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/full root access to the host kernel/)).toBeTruthy();
    expect(screen.getByText(/equivalent to root on the host/)).toBeTruthy();
    expect(screen.getAllByText("agent")).toHaveLength(2);
  });

  it("requires an explicit confirmation", () => {
    const onConfirm = vi.fn();
    render(<ComposeRiskNotice risks={RISKS} onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText("I understand, install anyway"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("lets the user back out", () => {
    const onCancel = vi.fn();
    render(<ComposeRiskNotice risks={RISKS} onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByText("Cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables both actions while the install is running", () => {
    render(<ComposeRiskNotice risks={RISKS} isBusy onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect((screen.getByText("Installing…") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Cancel") as HTMLButtonElement).disabled).toBe(true);
  });
});
