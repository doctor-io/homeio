import { describe, expect, it, vi } from "vitest";
import {
  DBUS_ACCESS_POINT_IFACE,
  DBUS_DEVICE_IFACE,
  DBUS_IFACE,
  DBUS_PATH,
  DBUS_PROPS_IFACE,
  DBUS_WIRELESS_IFACE,
  DEVICE_STATE_ACTIVATED,
  DEVICE_TYPE_ETHERNET,
  DEVICE_TYPE_WIFI,
} from "@/services/dbus-helper/config.mjs";

const hoisted = vi.hoisted(() => ({
  systemBus: vi.fn(),
  osState: { addresses: {} as Record<string, { address: string; family: string }[]> },
}));

vi.mock("dbus-next", () => ({
  default: {
    systemBus: hoisted.systemBus,
    Variant: class Variant {
      signature: string;
      value: unknown;

      constructor(signature: string, value: unknown) {
        this.signature = signature;
        this.value = value;
      }
    },
  },
}));

vi.mock("node:os", () => ({
  default: { networkInterfaces: () => hoisted.osState.addresses },
  networkInterfaces: () => hoisted.osState.addresses,
}));

import { createNetworkService } from "@/services/dbus-helper/network-service.mjs";

const DISCONNECTED = 30;

type DeviceSpec = {
  path: string;
  iface: string;
  type: number;
  state: number;
  accessPoint?: string;
  ssid?: string;
  strength?: number;
};

/** A system bus that answers the handful of NetworkManager calls the helper makes. */
function systemBusWith(devices: DeviceSpec[]) {
  const deviceProperties = new Map<string, Record<string, unknown>>();
  const accessPointProperties: Record<string, Record<string, unknown>> = {};

  for (const device of devices) {
    deviceProperties.set(device.path, {
      DeviceType: device.type,
      Interface: device.iface,
      State: device.state,
      ActiveAccessPoint: device.accessPoint ?? "/",
    });

    if (device.accessPoint && device.accessPoint !== "/") {
      accessPointProperties[device.accessPoint] = {
        Ssid: device.ssid ?? "",
        HwAddress: "11:22:33:44:55:66",
        Strength: device.strength ?? 0,
        Frequency: 2437,
        WpaFlags: 0,
        RsnFlags: 0,
      };
    }
  }

  return {
    connection: { on() {} },
    getProxyObject: async (_service: string, path: string) => ({
      getInterface: (name: string) => {
        if (path === DBUS_PATH && name === DBUS_IFACE) {
          return {
            GetDevices: async () => devices.map((device) => device.path),
            on() {},
          };
        }

        if (name === DBUS_PROPS_IFACE) {
          return {
            Get: async (iface: string, property: string) => {
              const source =
                iface === DBUS_ACCESS_POINT_IFACE
                  ? accessPointProperties[path]
                  : deviceProperties.get(path);
              return { value: source?.[property] ?? null };
            },
          };
        }

        if (name === DBUS_DEVICE_IFACE || name === DBUS_WIRELESS_IFACE) return { on() {} };

        return {};
      },
    }),
  };
}

function statusService(devices: DeviceSpec[]) {
  hoisted.systemBus.mockReturnValue(systemBusWith(devices));
  return createNetworkService({ log: () => {} });
}

describe("dbus helper network status", () => {
  it("reports the wired link when a Wi-Fi radio is up but not associated", async () => {
    hoisted.osState.addresses = {
      wlan0: [],
      eth0: [{ address: "192.168.1.128", family: "IPv4" }],
    };

    const status = await statusService([
      { path: "/dev/wlan0", iface: "wlan0", type: DEVICE_TYPE_WIFI, state: DISCONNECTED },
      {
        path: "/dev/eth0",
        iface: "eth0",
        type: DEVICE_TYPE_ETHERNET,
        state: DEVICE_STATE_ACTIVATED,
      },
    ]).getNetworkStatus();

    expect(status).toEqual({
      connected: true,
      iface: "eth0",
      ssid: null,
      ipv4: "192.168.1.128",
      signalPercent: null,
    });
  });

  it("reports the Wi-Fi connection when the radio is associated", async () => {
    hoisted.osState.addresses = {
      wlan0: [{ address: "192.168.1.22", family: "IPv4" }],
      eth0: [{ address: "192.168.1.128", family: "IPv4" }],
    };

    const status = await statusService([
      {
        path: "/dev/wlan0",
        iface: "wlan0",
        type: DEVICE_TYPE_WIFI,
        state: DEVICE_STATE_ACTIVATED,
        accessPoint: "/ap/1",
        ssid: "HomeNet",
        strength: 66,
      },
      {
        path: "/dev/eth0",
        iface: "eth0",
        type: DEVICE_TYPE_ETHERNET,
        state: DEVICE_STATE_ACTIVATED,
      },
    ]).getNetworkStatus();

    expect(status).toEqual({
      connected: true,
      iface: "wlan0",
      ssid: "HomeNet",
      ipv4: "192.168.1.22",
      signalPercent: 66,
    });
  });

  it("reports nothing connected when neither radio is activated", async () => {
    hoisted.osState.addresses = {};

    const status = await statusService([
      { path: "/dev/wlan0", iface: "wlan0", type: DEVICE_TYPE_WIFI, state: DISCONNECTED },
      { path: "/dev/eth0", iface: "eth0", type: DEVICE_TYPE_ETHERNET, state: 20 },
    ]).getNetworkStatus();

    expect(status).toEqual({
      connected: false,
      iface: null,
      ssid: null,
      ipv4: null,
      signalPercent: null,
    });
  });
});
