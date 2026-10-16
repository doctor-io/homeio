import "server-only";

import { readFile } from "node:fs/promises";
import si from "systeminformation";
import { isContainerRuntime } from "@/lib/server/modules/system/update-service";
import type {
  NetworkInterfaceKind,
  NetworkInterfaceOverview,
  NetworkOverview,
} from "@/lib/shared/contracts/network";

const CACHE_MS = 2_000;

// Docker, bridges and VM plumbing: one per container, and none of them is a
// way in or out of the machine.
const PLUMBING_INTERFACE = /^(veth|br-|docker|virbr|vnet|lxc|cni|flannel)/;
const VPN_INTERFACE = /^(tailscale|wg|tun|tap|utun|zt)/;

// systemd-resolved lists the upstream servers here; /etc/resolv.conf then
// only says 127.0.0.53.
const RESOLV_CONF_PATHS = ["/run/systemd/resolve/resolv.conf", "/etc/resolv.conf"];

function textOrNull(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function countOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function bytesPerSecondToMbps(value: unknown) {
  const perSecond = countOrNull(value);
  return perSecond === null ? null : (perSecond * 8) / 1_000_000;
}

// Tunnels and VPN interfaces (tailscale0, wg0) report operstate "unknown" in
// sysfs even while they carry traffic, so an interface that holds an address
// counts as up; an addressless one has nothing to go on and stays unknown.
function upState(operstate: unknown, hasUsableAddress: boolean): boolean | null {
  if (operstate === "up") return true;
  if (operstate === "down") return false;
  return hasUsableAddress ? true : null;
}

// Every IPv6 interface carries a link-local address, so it says nothing about
// whether the interface is usable.
const LINK_LOCAL_IPV6 = /^fe80:/i;

// Virtual interfaces have no hardware address; systeminformation fills the
// field with zeros, which reads as a broken NIC when shown.
const ZERO_MAC = /^(?:00[:-]){5}00$/;

function macOrNull(value: unknown) {
  const mac = textOrNull(value);
  return mac !== null && !ZERO_MAC.test(mac) ? mac : null;
}

function kindOf(name: string, type: unknown): NetworkInterfaceKind {
  if (VPN_INTERFACE.test(name)) return "vpn";
  if (type === "wireless") return "wireless";
  if (type === "wired") return "wired";
  return "other";
}

export function parseNameservers(resolvConf: string) {
  const servers: string[] = [];
  for (const line of resolvConf.split("\n")) {
    const match = /^\s*nameserver\s+(\S+)/.exec(line);
    if (match && !servers.includes(match[1])) servers.push(match[1]);
  }
  return servers;
}

async function readDnsServers() {
  for (const filePath of RESOLV_CONF_PATHS) {
    try {
      const servers = parseNameservers(await readFile(filePath, "utf8"));
      if (servers.length > 0) return servers;
    } catch {
      // Not on this host; try the next file.
    }
  }
  return [];
}

async function collect(): Promise<NetworkOverview> {
  const [interfaces, stats, gateway, dnsServers] = await Promise.all([
    si.networkInterfaces().catch(() => []),
    si.networkStats("*").catch(() => []),
    si.networkGatewayDefault().catch(() => ""),
    readDnsServers(),
  ]);

  const statsByName = new Map(
    (Array.isArray(stats) ? stats : []).map((entry) => [entry.iface, entry]),
  );

  const list: NetworkInterfaceOverview[] = (Array.isArray(interfaces) ? interfaces : [interfaces])
    .filter((iface) => iface.iface && !iface.internal && !PLUMBING_INTERFACE.test(iface.iface))
    .map((iface) => {
      const traffic = statsByName.get(iface.iface);
      const ip4 = textOrNull(iface.ip4);
      const ip6 = textOrNull(iface.ip6);
      const hasUsableAddress = ip4 !== null || (ip6 !== null && !LINK_LOCAL_IPV6.test(ip6));
      return {
        iface: iface.iface,
        kind: kindOf(iface.iface, iface.type),
        up: upState(iface.operstate, hasUsableAddress),
        isDefault: Boolean(iface.default),
        ip4,
        ip4Subnet: textOrNull(iface.ip4subnet),
        ip6,
        mac: macOrNull(iface.mac),
        speedMbps: typeof iface.speed === "number" && iface.speed > 0 ? iface.speed : null,
        duplex: textOrNull(iface.duplex),
        dhcp: Boolean(iface.dhcp),
        rxBytes: countOrNull(traffic?.rx_bytes),
        txBytes: countOrNull(traffic?.tx_bytes),
        downloadMbps: bytesPerSecondToMbps(traffic?.rx_sec),
        uploadMbps: bytesPerSecondToMbps(traffic?.tx_sec),
        rxErrors: countOrNull(traffic?.rx_errors),
        txErrors: countOrNull(traffic?.tx_errors),
        rxDropped: countOrNull(traffic?.rx_dropped),
        txDropped: countOrNull(traffic?.tx_dropped),
      };
    })
    // Default first, then interfaces that are up, then by name.
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        Number(b.up === true) - Number(a.up === true) ||
        a.iface.localeCompare(b.iface),
    );

  return {
    inContainer: isContainerRuntime(),
    interfaces: list,
    gateway: textOrNull(gateway),
    dnsServers,
    checkedAt: new Date().toISOString(),
  };
}

let cached: { value: NetworkOverview; expiresAt: number } | null = null;
let inFlight: Promise<NetworkOverview> | null = null;

/** Cached for 2 s so several open Monitors share one round of probes. */
export async function getNetworkOverview(): Promise<NetworkOverview> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  inFlight ??= collect().finally(() => {
    inFlight = null;
  });
  const value = await inFlight;
  cached = { value, expiresAt: Date.now() + CACHE_MS };
  return value;
}
