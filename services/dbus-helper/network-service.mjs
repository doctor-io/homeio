import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import dbus from "dbus-next";
import {
  CONNECT_RATE_LIMIT_PER_MINUTE,
  DBUS_ACCESS_POINT_IFACE,
  DBUS_DEVICE_IFACE,
  DBUS_IFACE,
  DBUS_PROPS_IFACE,
  DBUS_SERVICE,
  DBUS_SETTINGS_CONNECTION_IFACE,
  DBUS_SETTINGS_IFACE,
  DBUS_SETTINGS_PATH,
  DBUS_WIRELESS_IFACE,
  DEVICE_STATE_ACTIVATED,
  DEVICE_TYPE_WIFI,
  WIRED_DEVICE_TYPES,
  DBUS_PATH,
} from "./config.mjs";
import { HelperServiceError } from "./errors.mjs";
import { withTimeout } from "./async-utils.mjs";

const { Variant } = dbus;

function decodeSsid(raw) {
  if (!raw) return "";
  if (Buffer.isBuffer(raw)) return raw.toString("utf8").replace(/\0/g, "").trim();
  if (Array.isArray(raw)) {
    return Buffer.from(raw).toString("utf8").replace(/\0/g, "").trim();
  }

  return typeof raw === "string" ? raw.trim() : "";
}

function toOptionalNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return value;
}

function frequencyToChannel(frequencyMhz) {
  if (typeof frequencyMhz !== "number" || frequencyMhz <= 0) return null;
  if (frequencyMhz >= 2412 && frequencyMhz <= 2484) {
    if (frequencyMhz === 2484) return 14;
    return Math.round((frequencyMhz - 2407) / 5);
  }

  if (frequencyMhz >= 5000 && frequencyMhz <= 5900) {
    return Math.round((frequencyMhz - 5000) / 5);
  }

  return null;
}

function dbusVariantValue(value) {
  if (value && typeof value === "object" && "value" in value) {
    return value.value;
  }

  return value;
}

function resolveInterfaceIpv4(iface) {
  if (!iface) return null;
  const interfaces = networkInterfaces();
  const records = interfaces[iface];
  if (!records || records.length === 0) return null;

  const ipv4 = records.find(
    (entry) => entry.family === "IPv4" || entry.family === 4,
  );
  return ipv4?.address ?? null;
}

function createNetworkService({ log }) {
  const connectAttempts = new Map();
  let bus = null;

  async function getBus() {
    if (!bus) {
      bus = dbus.systemBus();
      bus.connection.on("error", (error) => {
        log({
          level: "warn",
          action: "dbus.network.bus.error",
          status: "error",
          message: "System DBus connection error",
          error,
        });
      });
    }

    return bus;
  }

  async function getProxyObject(path) {
    const systemBus = await getBus();
    return systemBus.getProxyObject(DBUS_SERVICE, path);
  }

  async function getNmRoot() {
    try {
      const object = await getProxyObject(DBUS_PATH);
      return {
        object,
        nm: object.getInterface(DBUS_IFACE),
        props: object.getInterface(DBUS_PROPS_IFACE),
      };
    } catch (error) {
      throw new HelperServiceError("NetworkManager is unavailable", {
        code: "network_manager_unavailable",
        statusCode: 503,
        cause: error,
      });
    }
  }

  async function getProperty(propsInterface, iface, property) {
    const variant = await propsInterface.Get(iface, property);
    return dbusVariantValue(variant);
  }

  async function getWifiDevices() {
    const { nm } = await getNmRoot();
    const devicePaths = await withTimeout(nm.GetDevices());

    const devices = [];

    for (const path of devicePaths) {
      const deviceObject = await getProxyObject(path);
      const props = deviceObject.getInterface(DBUS_PROPS_IFACE);
      const deviceType = Number(await getProperty(props, DBUS_DEVICE_IFACE, "DeviceType"));
      if (deviceType !== DEVICE_TYPE_WIFI) continue;

      const iface = String(await getProperty(props, DBUS_DEVICE_IFACE, "Interface"));
      const state = Number(await getProperty(props, DBUS_DEVICE_IFACE, "State"));

      devices.push({
        path,
        iface,
        state,
        object: deviceObject,
        props,
        device: deviceObject.getInterface(DBUS_DEVICE_IFACE),
        wireless: deviceObject.getInterface(DBUS_WIRELESS_IFACE),
      });
    }

    return devices;
  }

  async function getEthernetDevices() {
    const { nm } = await getNmRoot();
    const devicePaths = await withTimeout(nm.GetDevices());

    const devices = [];

    for (const path of devicePaths) {
      const deviceObject = await getProxyObject(path);
      const props = deviceObject.getInterface(DBUS_PROPS_IFACE);
      const deviceType = Number(await getProperty(props, DBUS_DEVICE_IFACE, "DeviceType"));
      // Accept physical Ethernet (1) and virtual Ethernet/VETH (20) used in LXC/containers
      if (!WIRED_DEVICE_TYPES.has(deviceType)) continue;

      const iface = String(await getProperty(props, DBUS_DEVICE_IFACE, "Interface"));
      const state = Number(await getProperty(props, DBUS_DEVICE_IFACE, "State"));

      devices.push({ path, iface, state });
    }

    return devices;
  }

  async function getAccessPointSnapshot(apPath) {
    if (!apPath || apPath === "/") return null;

    const apObject = await getProxyObject(apPath);
    const props = apObject.getInterface(DBUS_PROPS_IFACE);
    const ssid = decodeSsid(await getProperty(props, DBUS_ACCESS_POINT_IFACE, "Ssid"));
    const bssid = String(await getProperty(props, DBUS_ACCESS_POINT_IFACE, "HwAddress") ?? "");
    const strength = toOptionalNumber(
      Number(await getProperty(props, DBUS_ACCESS_POINT_IFACE, "Strength")),
    );
    const frequency = toOptionalNumber(
      Number(await getProperty(props, DBUS_ACCESS_POINT_IFACE, "Frequency")),
    );
    const wpaFlags = Number(await getProperty(props, DBUS_ACCESS_POINT_IFACE, "WpaFlags"));
    const rsnFlags = Number(await getProperty(props, DBUS_ACCESS_POINT_IFACE, "RsnFlags"));

    return {
      ssid,
      bssid: bssid.trim().length > 0 ? bssid : null,
      signalPercent: strength,
      channel: frequencyToChannel(frequency),
      frequencyMhz: frequency,
      security: wpaFlags > 0 || rsnFlags > 0 ? "WPA/WPA2" : null,
      path: apPath,
    };
  }

  async function getNetworkStatus() {
    const wifiDevices = await getWifiDevices();
    // Only an activated Wi-Fi device is a connection. Falling back to any
    // Wi-Fi device reported a radio that is up but not associated as if it
    // were the live connection, which hid the Ethernet link that actually
    // carries the traffic and zeroed the rates the desktop shows (#66).
    const connectedWifi =
      wifiDevices.find((device) => device.state === DEVICE_STATE_ACTIVATED) ?? null;

    if (connectedWifi) {
      const activeAccessPointPath = await getProperty(
        connectedWifi.props,
        DBUS_WIRELESS_IFACE,
        "ActiveAccessPoint",
      );
      const activeAccessPoint = await getAccessPointSnapshot(activeAccessPointPath);

      return {
        connected: connectedWifi.state === DEVICE_STATE_ACTIVATED,
        iface: connectedWifi.iface,
        ssid: activeAccessPoint?.ssid ?? null,
        ipv4: resolveInterfaceIpv4(connectedWifi.iface),
        signalPercent: activeAccessPoint?.signalPercent ?? null,
      };
    }

    // No Wi-Fi — check for an active Ethernet connection (e.g. LXC/Proxmox)
    const ethernetDevices = await getEthernetDevices();
    const connectedEthernet =
      ethernetDevices.find((device) => device.state === DEVICE_STATE_ACTIVATED) ??
      null;

    if (connectedEthernet) {
      return {
        connected: true,
        iface: connectedEthernet.iface,
        ssid: null,
        ipv4: resolveInterfaceIpv4(connectedEthernet.iface),
        signalPercent: null,
      };
    }

    return {
      connected: false,
      iface: null,
      ssid: null,
      ipv4: null,
      signalPercent: null,
    };
  }

  async function scanNetworks() {
    const wifiDevices = await getWifiDevices();

    if (wifiDevices.length === 0) return [];

    await Promise.all(
      wifiDevices.map(async (device) => {
        try {
          await withTimeout(device.wireless.RequestScan({}), 4_000);
        } catch {
          return;
        }
      }),
    );

    await new Promise((resolve) => {
      setTimeout(resolve, 1_000);
    });

    const bySsid = new Map();

    for (const device of wifiDevices) {
      const apPaths = await withTimeout(device.wireless.GetAllAccessPoints(), 6_000);
      for (const apPath of apPaths) {
        const snapshot = await getAccessPointSnapshot(apPath);
        if (!snapshot?.ssid) continue;

        const existing = bySsid.get(snapshot.ssid);
        if (!existing || (snapshot.signalPercent ?? 0) > (existing.signalPercent ?? 0)) {
          bySsid.set(snapshot.ssid, {
            ssid: snapshot.ssid,
            bssid: snapshot.bssid,
            signalPercent: snapshot.signalPercent,
            channel: snapshot.channel,
            frequencyMhz: snapshot.frequencyMhz,
            security: snapshot.security,
            path: snapshot.path,
            devicePath: device.path,
          });
        }
      }
    }

    return [...bySsid.values()]
      .sort((left, right) => (right.signalPercent ?? 0) - (left.signalPercent ?? 0))
      .map((network) => ({
        ssid: network.ssid,
        bssid: network.bssid,
        signalPercent: network.signalPercent,
        channel: network.channel,
        frequencyMhz: network.frequencyMhz,
        security: network.security,
      }));
  }

  async function listSavedConnections() {
    const settingsObject = await getProxyObject(DBUS_SETTINGS_PATH);
    const settingsInterface = settingsObject.getInterface(DBUS_SETTINGS_IFACE);
    const paths = await withTimeout(settingsInterface.ListConnections(), 5_000);

    const connections = [];

    for (const path of paths) {
      const connectionObject = await getProxyObject(path);
      const settingsConnection = connectionObject.getInterface(
        DBUS_SETTINGS_CONNECTION_IFACE,
      );
      const settings = await withTimeout(settingsConnection.GetSettings(), 5_000);
      const connectionSettings = settings.connection ?? {};
      const wirelessSettings = settings["802-11-wireless"] ?? {};

      const type = dbusVariantValue(connectionSettings.type);
      const id = dbusVariantValue(connectionSettings.id);
      const ssid = decodeSsid(dbusVariantValue(wirelessSettings.ssid));

      connections.push({
        path,
        type: typeof type === "string" ? type : "",
        id: typeof id === "string" ? id : "",
        ssid,
      });
    }

    return connections;
  }

  async function findDeviceForSsid(ssid) {
    const wifiDevices = await getWifiDevices();
    if (wifiDevices.length === 0) {
      throw new HelperServiceError("No Wi-Fi device found", {
        code: "network_manager_unavailable",
        statusCode: 503,
      });
    }

    for (const device of wifiDevices) {
      const apPaths = await withTimeout(device.wireless.GetAllAccessPoints(), 6_000);
      for (const apPath of apPaths) {
        const accessPoint = await getAccessPointSnapshot(apPath);
        if (accessPoint?.ssid === ssid) {
          return {
            device,
            accessPoint,
          };
        }
      }
    }

    return {
      device: wifiDevices[0],
      accessPoint: null,
    };
  }

  function enforceConnectRateLimit(requestId) {
    const key = requestId && requestId.length > 0 ? requestId : "anonymous";
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const history = connectAttempts.get(key) ?? [];
    const activeHistory = history.filter((timestamp) => timestamp > oneMinuteAgo);

    if (activeHistory.length >= CONNECT_RATE_LIMIT_PER_MINUTE) {
      throw new HelperServiceError("Too many network connect attempts", {
        code: "invalid_request",
        statusCode: 429,
      });
    }

    activeHistory.push(now);
    connectAttempts.set(key, activeHistory);
  }

  async function connectNetwork({ ssid, password }, requestId) {
    enforceConnectRateLimit(requestId);

    const { nm } = await getNmRoot();
    const { device, accessPoint } = await findDeviceForSsid(ssid);

    const savedConnections = await listSavedConnections();
    const existingConnection =
      savedConnections.find(
        (connection) =>
          connection.type === "802-11-wireless" &&
          (connection.ssid === ssid || connection.id === ssid),
      ) ?? null;

    if (existingConnection) {
      await withTimeout(
        nm.ActivateConnection(
          existingConnection.path,
          device.path,
          accessPoint?.path ?? "/",
        ),
        10_000,
      );

      return getNetworkStatus();
    }

    const settings = {
      connection: {
        id: new Variant("s", ssid),
        type: new Variant("s", "802-11-wireless"),
        uuid: new Variant("s", randomUUID()),
        autoconnect: new Variant("b", true),
      },
      "802-11-wireless": {
        ssid: new Variant("ay", [...Buffer.from(ssid, "utf8")]),
        mode: new Variant("s", "infrastructure"),
      },
      ipv4: {
        method: new Variant("s", "auto"),
      },
      ipv6: {
        method: new Variant("s", "auto"),
      },
    };

    if (typeof password === "string") {
      settings["802-11-wireless-security"] = {
        "key-mgmt": new Variant("s", "wpa-psk"),
        psk: new Variant("s", password),
      };
    }

    await withTimeout(
      nm.AddAndActivateConnection(
        settings,
        device.path,
        accessPoint?.path ?? "/",
      ),
      15_000,
    );

    return getNetworkStatus();
  }

  async function disconnectNetwork({ iface }) {
    const wifiDevices = await getWifiDevices();
    const selectedDevice =
      (iface
        ? wifiDevices.find((device) => device.iface === iface)
        : wifiDevices.find((device) => device.state === DEVICE_STATE_ACTIVATED)) ??
      null;

    if (!selectedDevice) {
      return getNetworkStatus();
    }

    await withTimeout(selectedDevice.device.Disconnect(), 8_000);
    return getNetworkStatus();
  }

  async function emitConnectionChangedEvent(broadcastEvent) {
    try {
      const status = await getNetworkStatus();
      broadcastEvent({
        type: "network.connection.changed",
        timestamp: new Date().toISOString(),
        iface: status.iface,
        ssid: status.ssid,
        connected: status.connected,
      });
    } catch (error) {
      log({
        level: "warn",
        action: "dbus.network.event.connection",
        status: "error",
        message: "Failed to emit connection change event",
        error,
      });
    }
  }

  async function attachDbusEventBridge(broadcastEvent) {
    const { nm, props } = await getNmRoot();
    const wifiDevices = await getWifiDevices();

    props.on("PropertiesChanged", async (iface, changed) => {
      if (iface !== DBUS_IFACE) return;
      const changedRecord = changed ?? {};

      if ("ActiveConnections" in changedRecord || "PrimaryConnection" in changedRecord) {
        await emitConnectionChangedEvent(broadcastEvent);
      }
    });

    for (const device of wifiDevices) {
      device.device.on("StateChanged", async (newState, _oldState, reason) => {
        let status = {
          connected: false,
          iface: device.iface,
          ssid: null,
        };

        try {
          const current = await getNetworkStatus();
          status = {
            connected: current.connected,
            iface: current.iface,
            ssid: current.ssid,
          };
        } catch {
          // ignore and emit best effort event
        }

        broadcastEvent({
          type: "network.device.state.changed",
          timestamp: new Date().toISOString(),
          iface: status.iface,
          ssid: status.ssid,
          connected: status.connected,
          state: String(newState),
          reason: String(reason),
        });
      });
    }

    nm.on("DeviceAdded", async () => {
      await emitConnectionChangedEvent(broadcastEvent);
    });
    nm.on("DeviceRemoved", async () => {
      await emitConnectionChangedEvent(broadcastEvent);
    });
  }

  return {
    attachDbusEventBridge,
    connectNetwork,
    disconnectNetwork,
    getNetworkStatus,
    scanNetworks,
  };
}

export { createNetworkService, decodeSsid };
