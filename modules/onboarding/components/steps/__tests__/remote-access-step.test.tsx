/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteAccessStep } from "@/modules/onboarding/components/steps/remote-access-step";
import type { TailscaleStatusPublic } from "@/lib/shared/contracts/tailscale";

function status(overrides: Partial<TailscaleStatusPublic> = {}): TailscaleStatusPublic {
  return {
    installed: false,
    tunAvailable: true,
    running: false,
    connected: false,
    backendState: null,
    hostname: null,
    dnsName: null,
    tailscaleIps: [],
    issue: null,
    error: null,
    ...overrides,
  };
}

function mockStatus(payload: TailscaleStatusPublic, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ data: payload }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("RemoteAccessStep", () => {
  it("shows the tailnet address once connected", async () => {
    mockStatus(
      status({
        installed: true,
        running: true,
        connected: true,
        dnsName: "homeio.tail9c2f.ts.net",
        tailscaleIps: ["100.64.0.1"],
      }),
    );
    render(<RemoteAccessStep />);

    await waitFor(() => expect(screen.getByText("Connected")).toBeTruthy());
    expect(screen.getByText(/homeio\.tail9c2f\.ts\.net/)).toBeTruthy();
    expect(screen.getByText(/100\.64\.0\.1/)).toBeTruthy();
  });

  it("tells the wizard whether the server became reachable", async () => {
    mockStatus(status({ installed: true, connected: true, dnsName: "x.ts.net" }));
    const onConnectedChange = vi.fn();
    render(<RemoteAccessStep onConnectedChange={onConnectedChange} />);

    await waitFor(() => expect(onConnectedChange).toHaveBeenCalledWith(true));
  });

  it("offers to install when Tailscale is absent, then re-reads status", async () => {
    const fetchMock = mockStatus(status());
    render(<RemoteAccessStep />);

    await waitFor(() => expect(screen.getByText("Install and activate")).toBeTruthy());
    fireEvent.click(screen.getByText("Install and activate"));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url === "/api/v1/system/tailscale/install"),
      ).toBe(true),
    );
    // Status is re-read after the install so the panel reflects reality.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => url === "/api/v1/system/tailscale/status")
          .length,
      ).toBeGreaterThan(1),
    );
  });

  it("surfaces the existing missing_tun guidance instead of an install button", async () => {
    mockStatus(status({ issue: "missing_tun", tunAvailable: false }));
    render(<RemoteAccessStep />);

    await waitFor(() => expect(screen.getByText(/Proxmox LXC/)).toBeTruthy());
    expect(screen.queryByText("Install and activate")).toBeNull();
  });

  it("surfaces service_unavailable guidance", async () => {
    mockStatus(status({ installed: true, issue: "service_unavailable" }));
    render(<RemoteAccessStep />);

    await waitFor(() => expect(screen.getByText(/tailscaled service is not responding/)).toBeTruthy());
  });

  it("stays skippable when status cannot be read at all", async () => {
    mockStatus(status(), false);
    const onConnectedChange = vi.fn();
    render(<RemoteAccessStep onConnectedChange={onConnectedChange} />);

    await waitFor(() => expect(screen.getByText(/Skip for now/)).toBeTruthy());
    expect(onConnectedChange).toHaveBeenCalledWith(false);
  });
});
