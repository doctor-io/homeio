import "server-only";

import { access, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as systemd from "@/lib/server/platform/systemd";
import * as tailscale from "@/lib/server/platform/tailscale";
import { isCommandMissing } from "@/lib/server/platform/process";
import type {
  TailscaleInstallResult,
  TailscaleStatusPublic,
} from "@/lib/shared/contracts/tailscale";


async function hasTunDevice() {
  try {
    await access("/dev/net/tun");
    return true;
  } catch {
    return false;
  }
}

type TailscaleStatusJson = {
  BackendState?: string;
  Self?: {
    HostName?: string;
    DNSName?: string;
    TailscaleIPs?: string[];
    Online?: boolean;
  };
};

/** Delegates to the platform, which owns the error type. */
function isMissingCommand(error: unknown) {
  return isCommandMissing(error);
}

async function toStatus(data: TailscaleStatusJson): Promise<TailscaleStatusPublic> {
  const backendState = data.BackendState ?? null;
  const connected = backendState === "Running" || data.Self?.Online === true;
  const tunAvailable = await hasTunDevice();

  return {
    installed: true,
    tunAvailable,
    running: backendState !== null && backendState !== "NoState",
    connected,
    backendState,
    hostname: data.Self?.HostName ?? null,
    dnsName: data.Self?.DNSName ?? null,
    tailscaleIps: data.Self?.TailscaleIPs ?? [],
    issue: tunAvailable ? null : "missing_tun",
    error: null,
  };
}

export async function getLocalTailscaleStatus(): Promise<TailscaleStatusPublic> {
  const tunAvailable = await hasTunDevice();

  try {
    const stdout = await tailscale.status();
    return toStatus(JSON.parse(stdout) as TailscaleStatusJson);
  } catch (error) {
    if (isMissingCommand(error)) {
      return {
        installed: false,
        tunAvailable,
        running: false,
        connected: false,
        backendState: null,
        hostname: null,
        dnsName: null,
        tailscaleIps: [],
        issue: tunAvailable ? null : "missing_tun",
        error: "Tailscale CLI is not installed.",
      };
    }

    const message = error instanceof Error ? error.message : "Unable to read Tailscale status.";
    const missingTun = !tunAvailable || message.includes("/dev/net/tun") || message.includes("CreateTUN");

    return {
      installed: true,
      tunAvailable,
      running: false,
      connected: false,
      backendState: null,
      hostname: null,
      dnsName: null,
      tailscaleIps: [],
      issue: missingTun ? "missing_tun" : "service_unavailable",
      error: message,
    };
  }
}

let installLock = false;

export async function installTailscale(authKey?: string): Promise<TailscaleInstallResult> {
  if (installLock) {
    throw new Error("Tailscale installation already in progress. Please wait.");
  }
  installLock = true;
  try {
    return await runInstall(authKey);
  } finally {
    installLock = false;
  }
}

async function runInstall(authKey?: string): Promise<TailscaleInstallResult> {
  const currentStatus = await getLocalTailscaleStatus();
  let stdout = "";
  let stderr = "";

  if (!currentStatus.installed) {
    try {
      const installResult = await tailscale.install();
      stdout += installResult.stdout;
      stderr += installResult.stderr;
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message?: string };
      const detail = (e.stderr || e.stdout || e.message || "Unknown error").slice(0, 3000);
      throw new Error(`Tailscale install script failed:\n${detail}`);
    }
  }

  const nextStatus = await getLocalTailscaleStatus();
  if (!nextStatus.tunAvailable) {
    throw new Error("Tailscale requires /dev/net/tun. In Proxmox LXC, pass through dev/net/tun before activating.");
  }

  if (!authKey) {
    return {
      installed: true,
      activated: nextStatus.connected,
      stdout,
      stderr: stderr || "Tailscale is installed. Provide an auth key to activate this server.",
    };
  }

  await systemd.resetFailed("tailscaled");
  await systemd.enable("tailscaled", { now: true });

  const tmpKeyFile = join(tmpdir(), `ts-key-${randomBytes(8).toString("hex")}`);
  await writeFile(tmpKeyFile, authKey, { mode: 0o600 });
  try {
    const upResult = await tailscale.up(tmpKeyFile);
    stdout += upResult.stdout;
    stderr += upResult.stderr;
  } finally {
    await unlink(tmpKeyFile).catch(() => {});
  }

  return {
    installed: true,
    activated: true,
    stdout,
    stderr,
  };
}
