/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesStep } from "@/modules/onboarding/components/steps/services-step";

function statusFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation((url: string) => {
    const data =
      url.includes("tailscale")
        ? { connected: false, ...(overrides.tailscale as object) }
        : url.includes("cloudflare-tunnel")
          ? { running: false, ...(overrides.cloudflare as object) }
          : { hasSecret: false, ...(overrides.drive as object) };

    return Promise.resolve({ ok: true, json: async () => ({ data }) });
  });
}

describe("ServicesStep", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", statusFetch());
  });

  it("shows each service and what it is for", async () => {
    render(<ServicesStep onConnectedChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("service-tailscale")).toBeTruthy());
    expect(screen.getByTestId("service-cloudflare")).toBeTruthy();
    expect(screen.getByTestId("service-drive")).toBeTruthy();
  });

  it("reports what is already connected so setup does not ask twice", async () => {
    vi.stubGlobal("fetch", statusFetch({ tailscale: { connected: true } }));
    const onConnectedChange = vi.fn();

    render(<ServicesStep onConnectedChange={onConnectedChange} />);

    await waitFor(() => expect(onConnectedChange).toHaveBeenCalledWith(["tailscale"]));
    expect(screen.getByTestId("service-tailscale-state").textContent).toBe("Connected");
  });

  it("does not fail setup when a service cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<ServicesStep onConnectedChange={vi.fn()} />);

    // Every card still renders, all marked as not set up.
    await waitFor(() => expect(screen.getAllByText("Not set up")).toHaveLength(3));
  });
});
