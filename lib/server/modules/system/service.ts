import "server-only";

import { LruCache } from "@/lib/server/cache/lru";
import { serverEnv } from "@/lib/server/env";
import { logServerAction } from "@/lib/server/logging/logger";
import type { SmartDiskInfo, StorageMetrics, SystemMetricsSnapshot } from "@/lib/shared/contracts/system";
import os from "node:os";
import { statfs } from "node:fs/promises";
import path from "node:path";
import si from "systeminformation";
import {
  getNetworkStatusFromHelper,
  isNetworkHelperUnavailableError,
} from "@/lib/server/modules/network/helper-client";

const metricsCache = new LruCache<SystemMetricsSnapshot>(
  8,
  serverEnv.METRICS_CACHE_TTL_MS,
);
const HELPER_STATUS_CACHE_TTL_MS = 10_000;
const HELPER_STATUS_UNAVAILABLE_BACKOFF_MS = 15_000;
const HELPER_STATUS_ERROR_LOG_COOLDOWN_MS = 30_000;
const STORAGE_DETAILS_CACHE_TTL_MS = 60_000;
const WIFI_NETWORKS_CACHE_TTL_MS = 30_000;
const WIFI_CONNECTIONS_CACHE_TTL_MS = 15_000;

/** Filesystem types that are virtual/pseudo and should not appear as real disk volumes. */
const VIRTUAL_FS_TYPES = new Set([
  "overlay",
  "tmpfs",
  "squashfs",
  "devtmpfs",
  "sysfs",
  "proc",
  "cgroup",
  "cgroup2",
  "nsfs",
  "fusectl",
  "hugetlbfs",
  "mqueue",
  "debugfs",
  "tracefs",
  "securityfs",
  "configfs",
  "pstore",
  "autofs",
  "efivarfs",
  "bpf",
]);

type CachedStorageDetails = Pick<StorageMetrics, "volumes" | "raid" | "smart">;

let helperStatusCache:
  | {
      value: Awaited<ReturnType<typeof getNetworkStatusFromHelper>>;
      expiresAt: number;
    }
  | null = null;
let wifiNetworksCache: {
  value: Awaited<ReturnType<typeof si.wifiNetworks>>;
  expiresAt: number;
} | null = null;
let wifiNetworksRefreshing = false;
let wifiConnectionsCache: {
  value: Awaited<ReturnType<typeof si.wifiConnections>>;
  expiresAt: number;
} | null = null;
let wifiConnectionsRefreshing = false;
let storageDetailsCache:
  | {
      value: CachedStorageDetails;
      expiresAt: number;
    }
  | null = null;
/** Last successfully collected storage details — persists beyond cache TTL for stale serving. */
let storageDetailsLastKnown: CachedStorageDetails | null = null;
/** True while a background (or first-ever) storage detail collection is in flight. */
let storageDetailsRefreshing = false;
let helperStatusUnavailableUntil = 0;
let lastHelperStatusErrorLogAt = 0;
/**
 * In-flight snapshot collection, shared by all concurrent callers.
 * collectSnapshot shells out to `sensors`, `nmcli` and `ip`; on a slow box it can
 * outlast METRICS_PUBLISH_INTERVAL_MS, and without this guard every SSE tick
 * started another one on top of the last until the subprocesses ate the CPU.
 */
let snapshotInFlight: Promise<SystemMetricsSnapshot> | null = null;

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Number(value.toFixed(2)), 100));
}

function toNumber(value: number | bigint) {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return value;
}

function toFiniteNumber(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function baseDeviceFromPartition(device: string) {
  return device.replace(/p?\d+$/, "");
}

function deriveVolumeLabel(input: {
  device: string;
  mountPath: string;
  mediaType: string | null;
}) {
  const mountName =
    input.mountPath === "/"
      ? "System"
      : input.mountPath.startsWith("/DATA")
        ? "Data"
        : path.basename(input.mountPath) || "Volume";
  const mediaSuffix = input.mediaType ? ` (${input.mediaType})` : "";
  return `${input.device} - ${mountName}${mediaSuffix}`;
}

function inferRaidFromVolumes(
  volumes: NonNullable<StorageMetrics["volumes"]>,
): StorageMetrics["raid"] {
  const zfsVolumes = volumes.filter((volume) =>
    volume.filesystem?.toLowerCase().includes("zfs"),
  );
  if (zfsVolumes.length > 0) {
    return {
      name: "zpool",
      type: "ZFS",
      totalBytes: zfsVolumes.reduce((sum, volume) => sum + volume.totalBytes, 0),
      redundancy: "Managed by ZFS",
      status: "healthy",
    };
  }

  const mdVolumes = volumes.filter((volume) => volume.device.startsWith("/dev/md"));
  if (mdVolumes.length > 0) {
    return {
      name: path.basename(mdVolumes[0].device),
      type: "Linux RAID",
      totalBytes: mdVolumes.reduce((sum, volume) => sum + volume.totalBytes, 0),
      redundancy: "Managed by mdadm",
      status: "healthy",
    };
  }

  return null;
}

function summarizeSmartHealth(
  diskLayout: Awaited<ReturnType<typeof si.diskLayout>>,
): StorageMetrics["smart"] {
  if (diskLayout.length === 0) {
    return null;
  }

  let healthyDisks = 0;
  let failingDisks = 0;
  const disks: SmartDiskInfo[] = [];

  for (const disk of diskLayout) {
    if (typeof disk.device !== "string" || disk.device.trim().length === 0) continue;

    const rawStatus =
      typeof disk.smartStatus === "string"
        ? disk.smartStatus.trim().toLowerCase()
        : "";

    let diskStatus: SmartDiskInfo["status"];
    if (
      rawStatus.includes("fail") ||
      rawStatus.includes("error") ||
      rawStatus.includes("pred") ||
      rawStatus.includes("bad")
    ) {
      diskStatus = "degraded";
      failingDisks += 1;
    } else if (
      rawStatus.includes("ok") ||
      rawStatus.includes("good") ||
      rawStatus.includes("pass")
    ) {
      diskStatus = "healthy";
      healthyDisks += 1;
    } else {
      diskStatus = "unknown";
    }

    const temperatureCelsius =
      disk.temperature !== null &&
      typeof disk.temperature === "number" &&
      Number.isFinite(disk.temperature) &&
      disk.temperature > 0
        ? Math.round(disk.temperature)
        : null;

    const smartDataHours = disk.smartData?.power_on_time?.hours;
    const powerOnHours =
      typeof smartDataHours === "number" &&
      Number.isFinite(smartDataHours) &&
      smartDataHours >= 0
        ? Math.round(smartDataHours)
        : null;

    const sizeBytes =
      typeof disk.size === "number" && Number.isFinite(disk.size) && disk.size > 0
        ? disk.size
        : null;

    disks.push({
      device: disk.device.trim(),
      name:
        typeof disk.name === "string" && disk.name.trim().length > 0
          ? disk.name.trim()
          : null,
      vendor:
        typeof disk.vendor === "string" && disk.vendor.trim().length > 0
          ? disk.vendor.trim()
          : null,
      type:
        typeof disk.type === "string" && disk.type.trim().length > 0
          ? disk.type.trim().toUpperCase()
          : null,
      sizeBytes,
      status: diskStatus,
      smartStatus:
        typeof disk.smartStatus === "string" && disk.smartStatus.trim().length > 0
          ? disk.smartStatus.trim()
          : "Unknown",
      temperatureCelsius,
      powerOnHours,
    });
  }

  if (disks.length === 0) {
    return null;
  }

  const status =
    failingDisks > 0 ? "degraded" : healthyDisks > 0 ? "healthy" : "unknown";

  const message =
    status === "degraded"
      ? `${failingDisks} drive(s) reported potential SMART issues.`
      : status === "healthy"
        ? `All ${healthyDisks} SMART-capable drive(s) report healthy status.`
        : "SMART status unavailable for detected drives.";

  return {
    status,
    healthyDisks,
    failingDisks,
    checkedAt: new Date().toISOString(),
    message,
    disks,
  };
}

function readStorageDetailsCache() {
  if (!storageDetailsCache) return null;
  if (storageDetailsCache.expiresAt <= Date.now()) {
    storageDetailsCache = null;
    return null;
  }
  return storageDetailsCache.value;
}

/**
 * Execute the expensive storage detail collection (fsSize + diskLayout probes).
 * Updates both the TTL cache and the persistent lastKnown value.
 */
async function executeStorageDetailCollection(): Promise<CachedStorageDetails> {
  const [fsSizes, diskLayout] = await Promise.all([
    withFallback("system.metrics.storage.fsSize", () => si.fsSize(), []),
    withFallback("system.metrics.storage.diskLayout", () => si.diskLayout(), []),
  ]);

  const mediaTypeByDevice = new Map<string, string>();
  for (const disk of diskLayout) {
    if (typeof disk.device !== "string" || disk.device.trim().length === 0) continue;
    const mediaType =
      typeof disk.type === "string" && disk.type.trim().length > 0
        ? disk.type.trim().toUpperCase()
        : null;
    if (!mediaType) continue;
    mediaTypeByDevice.set(baseDeviceFromPartition(disk.device), mediaType);
  }

  // Track seen devices so we only include one entry per physical device
  // (e.g. /dev/nvme0n1p2 mounted at both / and /boot should show only one).
  const seenDevices = new Set<string>();

  const volumes = fsSizes
    .map((fsSize) => {
      const totalBytesRaw = toFiniteNumber(fsSize.size);
      if (totalBytesRaw === null || totalBytesRaw <= 0) {
        return null;
      }

      const filesystem =
        typeof fsSize.type === "string" && fsSize.type.trim().length > 0
          ? fsSize.type.trim()
          : null;

      // Skip virtual / pseudo filesystems (Docker overlay layers, tmpfs, snap, etc.)
      if (filesystem && VIRTUAL_FS_TYPES.has(filesystem.toLowerCase())) {
        return null;
      }

      const totalBytes = Math.max(Math.round(totalBytesRaw), 0);
      const usedBytesRaw = toFiniteNumber(fsSize.used);
      const usedPercentRaw = toFiniteNumber(fsSize.use);
      const inferredUsedBytes =
        usedPercentRaw !== null
          ? Math.round((totalBytes * clampPercent(usedPercentRaw)) / 100)
          : 0;
      const usedBytes =
        usedBytesRaw !== null
          ? Math.max(Math.round(usedBytesRaw), 0)
          : Math.max(inferredUsedBytes, 0);
      const usedPercent =
        usedPercentRaw !== null
          ? clampPercent(usedPercentRaw)
          : totalBytes > 0
            ? clampPercent((usedBytes / totalBytes) * 100)
            : 0;

      const mountPath =
        typeof fsSize.mount === "string" && fsSize.mount.trim().length > 0
          ? fsSize.mount
          : "/";
      const device =
        typeof fsSize.fs === "string" && fsSize.fs.trim().length > 0
          ? fsSize.fs
          : mountPath;

      // Deduplicate real block devices — keep only the first (most significant) mount point
      const baseDevice = baseDeviceFromPartition(device);
      if (baseDevice.startsWith("/dev/") && seenDevices.has(device)) {
        return null;
      }
      if (baseDevice.startsWith("/dev/")) {
        seenDevices.add(device);
      }

      const mediaType = mediaTypeByDevice.get(baseDevice) ?? null;

      return {
        id: `${device}:${mountPath}`,
        label: deriveVolumeLabel({ device, mountPath, mediaType }),
        mountPath,
        device,
        filesystem,
        mediaType,
        totalBytes,
        usedBytes: Math.min(usedBytes, totalBytes),
        usedPercent,
      };
    })
    .filter((volume): volume is NonNullable<typeof volume> => volume !== null)
    .sort((left, right) => right.usedBytes - left.usedBytes)
    .slice(0, 8);

  const details: CachedStorageDetails = {
    volumes,
    raid: inferRaidFromVolumes(volumes),
    smart: summarizeSmartHealth(diskLayout),
  };

  storageDetailsCache = {
    value: details,
    expiresAt: Date.now() + STORAGE_DETAILS_CACHE_TTL_MS,
  };
  storageDetailsLastKnown = details;

  return details;
}

/**
 * Returns storage details using a stale-while-revalidate strategy:
 *  - Fresh cache hit  → return immediately (no I/O).
 *  - Stale but data exists → return last-known value instantly; kick off a
 *    background refresh so the *next* call gets fresh data.
 *  - First call ever → must await the probe (no prior data to serve).
 *
 * This prevents the 1-3 s fsSize/diskLayout probes from blocking every SSE push
 * after the 60-second TTL expires.
 */
async function collectStorageDetailMetrics(): Promise<CachedStorageDetails> {
  // 1) Fresh cache hit — no I/O needed.
  const cached = readStorageDetailsCache();
  if (cached) return cached;

  // 2) We have a previously collected value. Serve it immediately and refresh
  //    in the background so the next cache miss gets fresh data.
  if (storageDetailsLastKnown !== null) {
    if (!storageDetailsRefreshing) {
      storageDetailsRefreshing = true;
      void executeStorageDetailCollection()
        .catch((error) => {
          logServerAction({
            level: "warn",
            layer: "service",
            action: "system.metrics.storage.background-refresh",
            status: "error",
            message: "Background storage detail refresh failed",
            error,
          });
        })
        .finally(() => {
          storageDetailsRefreshing = false;
        });
    }
    return storageDetailsLastKnown;
  }

  // 3) First call ever — must await synchronously (no stale value to serve).
  storageDetailsRefreshing = true;
  try {
    return await executeStorageDetailCollection();
  } finally {
    storageDetailsRefreshing = false;
  }
}

async function collectStorageMetrics() {
  try {
    const configuredRoot = serverEnv.FILES_ROOT;
    const targetPath = path.isAbsolute(configuredRoot)
      ? configuredRoot
      : path.resolve(process.cwd(), configuredRoot);
    const filesystemStats = await statfs(targetPath);

    const blockSize = toNumber(filesystemStats.bsize);
    const totalBlocks = toNumber(filesystemStats.blocks);
    const availableBlocks = toNumber(filesystemStats.bavail);
    const totalBytes = Math.max(Math.round(blockSize * totalBlocks), 0);
    const availableBytes = Math.max(Math.round(blockSize * availableBlocks), 0);
    const usedBytes = Math.max(totalBytes - availableBytes, 0);
    const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
    const details = await collectStorageDetailMetrics();

    return {
      mountPath: targetPath,
      totalBytes,
      availableBytes,
      usedBytes,
      usedPercent: clampPercent(usedPercent),
      ...details,
    };
  } catch (error) {
    logServerAction({
      level: "warn",
      layer: "service",
      action: "system.metrics.storage",
      status: "error",
      message: "Unable to collect storage metrics",
      error,
    });
    return null;
  }
}

function toNullableMetric(
  value: number | undefined,
  options?: {
    precision?: number;
    allowZero?: boolean;
  },
) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;

  const allowZero = options?.allowZero ?? false;
  if (!allowZero && value <= 0) return null;

  const precision = options?.precision ?? 1;
  return Number(value.toFixed(precision));
}

function toNullablePercent(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(Math.round(value), 100));
}

function toNullableText(value: string | undefined | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toDesignToMaxCapacityPercent(
  designedCapacityWh: number | null,
  maxCapacityWh: number | null,
) {
  if (designedCapacityWh === null || maxCapacityWh === null) return null;
  if (maxCapacityWh <= 0) return null;

  return Number(((maxCapacityWh / designedCapacityWh) * 100).toFixed(1));
}

/**
 * Returns cached WiFi networks immediately (or [] on first call) and
 * triggers a background scan so the next call gets fresh data.
 * This prevents the 5-8s WiFi scan from blocking the metrics snapshot.
 */
function getWifiNetworksStale(): Awaited<ReturnType<typeof si.wifiNetworks>> {
  const now = Date.now();

  if (wifiNetworksCache && wifiNetworksCache.expiresAt > now) {
    return wifiNetworksCache.value;
  }

  if (!wifiNetworksRefreshing) {
    wifiNetworksRefreshing = true;
    void withFallback("system.metrics.wifiNetworks", () => si.wifiNetworks(), [])
      .then((networks) => {
        wifiNetworksCache = { value: networks, expiresAt: Date.now() + WIFI_NETWORKS_CACHE_TTL_MS };
      })
      .finally(() => {
        wifiNetworksRefreshing = false;
      });
  }

  return wifiNetworksCache?.value ?? [];
}

/**
 * The same treatment as the scan above, and for the same reason measured on a
 * bigger scale: `wifiConnections` shells out to `system_profiler` on macOS and
 * took 8.8-12.7s per call on the development machine. Awaiting it inline made
 * every metrics cache miss cost that, because the snapshot gathers with
 * Promise.all and pays for the slowest probe.
 *
 * A shorter TTL than the network scan: this is the link the server is on, and
 * it appears on the phone's Home screen, so it should not lag reality by half a
 * minute. Fifteen seconds still turns ~30 blocking calls a minute into two in
 * the background.
 */
function getWifiConnectionsStale(): Awaited<ReturnType<typeof si.wifiConnections>> {
  const now = Date.now();

  if (wifiConnectionsCache && wifiConnectionsCache.expiresAt > now) {
    return wifiConnectionsCache.value;
  }

  if (!wifiConnectionsRefreshing) {
    wifiConnectionsRefreshing = true;
    void withFallback("system.metrics.wifiConnections", () => si.wifiConnections(), [])
      .then((connections) => {
        wifiConnectionsCache = {
          value: connections,
          expiresAt: Date.now() + WIFI_CONNECTIONS_CACHE_TTL_MS,
        };
      })
      .finally(() => {
        wifiConnectionsRefreshing = false;
      });
  }

  return wifiConnectionsCache?.value ?? [];
}

/** Test seam only: the Wi-Fi caches are module state that outlives a test. */
export function _resetWifiCachesForTesting() {
  wifiConnectionsCache = null;
  wifiConnectionsRefreshing = false;
  wifiNetworksCache = null;
  wifiNetworksRefreshing = false;
}

async function withFallback<T>(
  action: string,
  run: () => Promise<T>,
  fallback: T,
) {
  try {
    return await run();
  } catch (error) {
    logServerAction({
      level: "warn",
      layer: "service",
      action,
      status: "error",
      error,
      message: "systeminformation probe failed; using fallback",
    });
    return fallback;
  }
}

async function collectSnapshot(): Promise<SystemMetricsSnapshot> {
  const [oneMinute, fiveMinute, fifteenMinute] = os.loadavg();
  const cpuCores = os.cpus().length || 1;
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(totalBytes - freeBytes, 0);
  const defaultCpuPercent = Math.min((oneMinute / cpuCores) * 100, 100);

  const [
    currentLoad,
    cpuTemperature,
    batteryData,
    wifiConnections,
    wifiNetworks,
    networkInterfaces,
    networkStats,
    storageMetrics,
  ] = await Promise.all([
    withFallback("system.metrics.currentLoad", () => si.currentLoad(), null),
    withFallback(
      "system.metrics.cpuTemperature",
      () => si.cpuTemperature(),
      null,
    ),
    withFallback("system.metrics.battery", () => si.battery(), null),
    Promise.resolve(getWifiConnectionsStale()),
    Promise.resolve(getWifiNetworksStale()),
    withFallback(
      "system.metrics.networkInterfaces",
      () => si.networkInterfaces(),
      [],
    ),
    withFallback("system.metrics.networkStats", () => si.networkStats(), []),
    collectStorageMetrics(),
  ]);

  const mainTemperature = toNullableMetric(cpuTemperature?.main);
  const normalizedCoreTemps = (cpuTemperature?.cores ?? [])
    .map((coreTemp) => toNullableMetric(coreTemp))
    .filter((coreTemp): coreTemp is number => coreTemp !== null);
  const maxTemperature = toNullableMetric(cpuTemperature?.max);

  // Try to get WiFi status from NetworkManager D-Bus helper first (more reliable),
  // but cache it to avoid querying DBus for every metrics stream frame.
  const helperStatus = await resolveHelperStatusForMetrics();

  const primaryWifiConnection =
    wifiConnections.find(
      (connection) =>
        connection.iface.length > 0 || connection.ssid.trim().length > 0,
    ) ?? null;
  const primaryNetworkInterface = primaryWifiConnection
    ? (networkInterfaces.find(
        (networkInterface) =>
          networkInterface.iface === primaryWifiConnection.iface,
      ) ?? null)
    : (networkInterfaces.find((networkInterface) => networkInterface.default) ??
      null);

  // Prefer D-Bus helper data for WiFi status (more reliable with NetworkManager)
  const connectedSsid = helperStatus?.ssid?.trim() ?? primaryWifiConnection?.ssid.trim() ?? "";
  const isWifiConnected = connectedSsid.length > 0;
  // Ethernet: no SSID but a default interface has an IPv4 address
  const isEthernetConnected =
    !isWifiConnected && (primaryNetworkInterface?.ip4?.length ?? 0) > 0;
  const preferredIface =
    helperStatus?.iface ?? primaryNetworkInterface?.iface ?? primaryWifiConnection?.iface ?? null;
  const primaryNetworkStats =
    networkStats.find((stats) => stats.iface === preferredIface) ??
    networkStats.find((stats) => stats.operstate === "up") ??
    networkStats[0] ??
    null;
  const designedCapacityWh = batteryData?.hasBattery
    ? toNullableMetric(batteryData.designedCapacity, {
        precision: 0,
      })
    : null;
  const maxCapacityWh = batteryData?.hasBattery
    ? toNullableMetric(batteryData.maxCapacity, {
        precision: 0,
      })
    : null;
  const availableNetworks = wifiNetworks
    .filter((network) => network.ssid.trim().length > 0)
    .sort((left, right) => (right.quality ?? 0) - (left.quality ?? 0))
    .slice(0, 6)
    .map((network) => ({
      ssid: network.ssid.trim(),
      channel: Number.isFinite(network.channel) ? network.channel : null,
      qualityPercent: toNullablePercent(network.quality),
      security:
        network.security.length > 0
          ? network.security.join(", ")
          : network.rsnFlags.length > 0
            ? network.rsnFlags.join(", ")
            : null,
    }));
  return {
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    architecture: os.arch(),
    uptimeSeconds: os.uptime(),
    cpu: {
      oneMinute,
      fiveMinute,
      fifteenMinute,
      normalizedPercent: clampPercent(
        currentLoad?.currentLoad ?? defaultCpuPercent,
      ),
    },
    memory: {
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
    },
    temperature: {
      mainCelsius: mainTemperature,
      maxCelsius: maxTemperature,
      coresCelsius: normalizedCoreTemps,
    },
    battery: {
      hasBattery: Boolean(batteryData?.hasBattery),
      isCharging: Boolean(batteryData?.isCharging),
      percent: batteryData?.hasBattery
        ? toNullablePercent(batteryData.percent)
        : null,
      timeRemainingMinutes:
        batteryData?.hasBattery &&
        typeof batteryData.timeRemaining === "number" &&
        batteryData.timeRemaining >= 0
          ? Math.round(batteryData.timeRemaining)
          : null,
      acConnected:
        typeof batteryData?.acConnected === "boolean"
          ? batteryData.acConnected
          : null,
      manufacturer: batteryData?.hasBattery
        ? toNullableText(batteryData?.manufacturer)
        : null,
      cycleCount:
        batteryData?.hasBattery &&
        typeof batteryData.cycleCount === "number" &&
        Number.isFinite(batteryData.cycleCount) &&
        batteryData.cycleCount >= 0
          ? Math.round(batteryData.cycleCount)
          : null,
      designedCapacityWh,
      maxCapacityWh,
      designToMaxCapacityPercent: toDesignToMaxCapacityPercent(
        designedCapacityWh,
        maxCapacityWh,
      ),
    },
    storage: storageMetrics ?? undefined,
    wifi: {
      connected: helperStatus?.connected ?? (isWifiConnected || isEthernetConnected),
      iface:
        helperStatus?.iface ?? (primaryWifiConnection?.iface || primaryNetworkInterface?.iface || null),
      ssid: helperStatus?.ssid ?? (isWifiConnected ? connectedSsid : null),
      bssid: primaryWifiConnection?.bssid || null,
      signalPercent: helperStatus?.signalPercent ?? toNullablePercent(primaryWifiConnection?.quality),
      txRateMbps: toNullableMetric(primaryWifiConnection?.txRate, {
        precision: 1,
        allowZero: true,
      }),
      downloadMbps: toNullableMetric(
        primaryNetworkStats
          ? (primaryNetworkStats.rx_sec * 8) / 1_000_000
          : undefined,
        {
          precision: 2,
          allowZero: true,
        },
      ),
      uploadMbps: toNullableMetric(
        primaryNetworkStats
          ? (primaryNetworkStats.tx_sec * 8) / 1_000_000
          : undefined,
        {
          precision: 2,
          allowZero: true,
        },
      ),
      ipv4:
        helperStatus?.ipv4 ?? (primaryNetworkInterface && primaryNetworkInterface.ip4.length > 0
          ? primaryNetworkInterface.ip4
          : null),
      ipv6:
        primaryNetworkInterface && primaryNetworkInterface.ip6.length > 0
          ? primaryNetworkInterface.ip6
          : null,
      availableNetworks,
    },
    process: {
      pid: process.pid,
      uptimeSeconds: process.uptime(),
      nodeVersion: process.version,
    },
  };
}

export async function getSystemMetricsSnapshot(options?: {
  bypassCache?: boolean;
}) {
  const startedAt = performance.now();

  if (!options?.bypassCache) {
    const cached = metricsCache.get("latest");
    if (cached) {
      logServerAction({
        level: "debug",
        layer: "service",
        action: "system.metrics.snapshot",
        status: "success",
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        meta: {
          cache: "hit",
        },
      });
      return cached;
    }
  }

  const joinedInFlight = !options?.bypassCache && snapshotInFlight !== null;
  let pending = snapshotInFlight;
  if (!joinedInFlight || pending === null) {
    const collection: Promise<SystemMetricsSnapshot> = collectSnapshot().finally(() => {
      if (snapshotInFlight === collection) {
        snapshotInFlight = null;
      }
    });
    snapshotInFlight = collection;
    pending = collection;
  }

  const snapshot = await pending;
  metricsCache.set("latest", snapshot);

  logServerAction({
    level: "debug",
    layer: "service",
    action: "system.metrics.snapshot",
    status: "success",
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    meta: {
      cache: joinedInFlight ? "in-flight" : "miss",
    },
  });

  return snapshot;
}

function readHelperStatusCache() {
  if (!helperStatusCache) return null;
  if (helperStatusCache.expiresAt <= Date.now()) {
    helperStatusCache = null;
    return null;
  }

  return helperStatusCache.value;
}

async function resolveHelperStatusForMetrics() {
  const cached = readHelperStatusCache();
  if (cached) {
    return cached;
  }

  if (Date.now() < helperStatusUnavailableUntil) {
    return null;
  }

  try {
    const status = await getNetworkStatusFromHelper();
    helperStatusCache = {
      value: status,
      expiresAt: Date.now() + HELPER_STATUS_CACHE_TTL_MS,
    };
    helperStatusUnavailableUntil = 0;
    return status;
  } catch (error) {
    if (isNetworkHelperUnavailableError(error)) {
      helperStatusUnavailableUntil = Date.now() + HELPER_STATUS_UNAVAILABLE_BACKOFF_MS;
      return null;
    }

    const now = Date.now();
    if (now - lastHelperStatusErrorLogAt >= HELPER_STATUS_ERROR_LOG_COOLDOWN_MS) {
      lastHelperStatusErrorLogAt = now;
      logServerAction({
        level: "warn",
        layer: "service",
        action: "system.metrics.network.helper",
        status: "error",
        message: "Failed to get network status from D-Bus helper",
        error,
      });
    }

    return null;
  }
}
