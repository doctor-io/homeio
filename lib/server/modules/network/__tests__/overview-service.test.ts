import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { siMock, readFileMock } = vi.hoisted(() => ({
  siMock: {
    networkInterfaces: vi.fn(),
    networkStats: vi.fn(),
    networkGatewayDefault: vi.fn(),
  },
  readFileMock: vi.fn(),
}));

vi.mock("systeminformation", () => ({ default: siMock }));
vi.mock("node:fs/promises", () => ({ readFile: readFileMock }));
vi.mock("@/lib/server/modules/system/update-service", () => ({ isContainerRuntime: () => false }));

import { getNetworkOverview, parseNameservers } from "@/lib/server/modules/network/overview-service";

function iface(name: string, extra: Record<string, unknown> = {}) {
  return { iface: name, internal: false, operstate: "up", type: "wired", ip4: "", mac: "", speed: -1, default: false, dhcp: false, ...extra };
}

describe("network overview", () => {
  let minute = 0;

  beforeEach(() => {
    // A minute apart per test, so the service's 2 s cache never carries over.
    vi.useFakeTimers();
    minute += 1;
    vi.setSystemTime(Date.UTC(2026, 8, 27, 12, minute));
    siMock.networkInterfaces.mockReset();
    siMock.networkStats.mockReset();
    siMock.networkGatewayDefault.mockReset();
    readFileMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists real interfaces with their traffic, default first, and hides container plumbing", async () => {
    siMock.networkInterfaces.mockResolvedValue([
      iface("lo", { internal: true }),
      iface("docker0"),
      iface("veth12ab"),
      iface("br-5f2c"),
      iface("wlan0", { type: "wireless", operstate: "down" }),
      iface("tailscale0", { type: "virtual", ip4: "100.113.171.79" }),
      iface("eth0", { default: true, ip4: "192.168.1.43", ip4subnet: "255.255.255.0", mac: "aa:bb", speed: 1000, duplex: "full", dhcp: true }),
    ]);
    siMock.networkStats.mockResolvedValue([
      { iface: "eth0", rx_bytes: 5_000_000, tx_bytes: 1_000_000, rx_sec: 125_000, tx_sec: 12_500, rx_errors: 0, tx_errors: 2, rx_dropped: 0, tx_dropped: 0 },
      { iface: "tailscale0", rx_bytes: 10, tx_bytes: 20, rx_sec: null, tx_sec: -1, rx_errors: 0, tx_errors: 0, rx_dropped: 0, tx_dropped: 0 },
    ]);
    siMock.networkGatewayDefault.mockResolvedValue("192.168.1.1");
    readFileMock.mockImplementation(async (file: string) => {
      if (file === "/run/systemd/resolve/resolv.conf") return "nameserver 1.1.1.1\nnameserver 9.9.9.9\n";
      return "nameserver 127.0.0.53\n";
    });

    const overview = await getNetworkOverview();

    expect(overview.interfaces.map((i) => [i.iface, i.kind, i.up])).toEqual([
      ["eth0", "wired", true],
      ["tailscale0", "vpn", true],
      ["wlan0", "wireless", false],
    ]);
    const eth0 = overview.interfaces[0];
    expect(eth0).toMatchObject({
      isDefault: true,
      ip4: "192.168.1.43",
      speedMbps: 1000,
      dhcp: true,
      rxBytes: 5_000_000,
      downloadMbps: 1,
      uploadMbps: 0.1,
      txErrors: 2,
    });
    expect(overview.interfaces[1]).toMatchObject({ downloadMbps: null, uploadMbps: null, ip4: "100.113.171.79" });
    expect(overview.gateway).toBe("192.168.1.1");
    expect(overview.inContainer).toBe(false);
    expect(overview.dnsServers).toEqual(["1.1.1.1", "9.9.9.9"]);
  });

  it("counts a tunnel with an address as up and hides its all-zero hardware address", async () => {
    siMock.networkInterfaces.mockResolvedValue([
      iface("eth0", { default: true, ip4: "192.168.1.128" }),
      // tailscale0: sysfs reports operstate "unknown" and no hardware address.
      iface("tailscale0", {
        type: "virtual",
        operstate: "unknown",
        ip4: "100.90.80.70",
        ip4subnet: "255.255.255.255",
        ip6: "fd7a:115c:a1e0::d130:2449",
        mac: "00:00:00:00:00:00",
      }),
      // A tunnel with only a link-local IPv6 address says nothing about its state.
      iface("wg0", { type: "virtual", operstate: "unknown", ip6: "fe80::a1" }),
    ]);
    siMock.networkStats.mockResolvedValue([]);
    siMock.networkGatewayDefault.mockResolvedValue("192.168.1.1");
    readFileMock.mockResolvedValue("nameserver 1.1.1.1\n");

    const overview = await getNetworkOverview();

    expect(overview.interfaces.find((entry) => entry.iface === "tailscale0")).toMatchObject({
      kind: "vpn",
      up: true,
      ip4: "100.90.80.70",
      ip4Subnet: "255.255.255.255",
      mac: null,
    });
    expect(overview.interfaces.find((entry) => entry.iface === "wg0")).toMatchObject({
      up: null,
      mac: null,
    });
    expect(overview.interfaces.find((entry) => entry.iface === "eth0")).toMatchObject({ up: true });
  });

  it("falls back to /etc/resolv.conf and reports no gateway as null", async () => {
    siMock.networkInterfaces.mockResolvedValue([iface("en0", { default: true })]);
    siMock.networkStats.mockResolvedValue([]);
    siMock.networkGatewayDefault.mockResolvedValue("");
    readFileMock.mockImplementation(async (file: string) => {
      if (file === "/run/systemd/resolve/resolv.conf") throw new Error("ENOENT");
      return "# generated\nnameserver 192.168.1.1\n";
    });

    const overview = await getNetworkOverview();

    expect(overview.gateway).toBeNull();
    expect(overview.dnsServers).toEqual(["192.168.1.1"]);
    expect(overview.interfaces[0]).toMatchObject({ iface: "en0", rxBytes: null, downloadMbps: null });
  });

  it("reads nameserver lines once each", () => {
    expect(parseNameservers("search lan\nnameserver 1.1.1.1\n  nameserver 1.1.1.1\nnameserver ::1\n")).toEqual([
      "1.1.1.1",
      "::1",
    ]);
  });
});
