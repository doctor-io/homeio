import "server-only";

import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "@/lib/server/env";
import { resolveStoreConfigDirectory } from "@/lib/server/modules/store/catalog-config";
import * as systemd from "@/lib/server/platform/systemd";
import { run } from "@/lib/server/platform/process";
import {
  resolveDataRootDirectory,
  resolveStoreStacksRoot,
} from "@/lib/server/storage/data-root";


const FACTORY_RESET_LOG_PATH = "/var/log/homeio-factory-reset.log";

// ── Systemd unit helpers ───────────────────────────────────────────────────────

const SYSTEMD_RUN_FLAGS = ["--quiet", "--collect"] as const;

const SYSTEMD_RUN_PROPERTIES = [
  "Type=exec",
  "KillMode=control-group",
  "TimeoutStopSec=30s",
  "SendSIGKILL=yes",
] as const;

/**
 * Schedules a short inline shell command via a transient systemd unit.
 * Used for simple one-liners like reboot and shutdown.
 */
async function scheduleSystemCommand(command: string, unitName: string) {
  await systemd.runDetachedCommand(command, {
    unit: unitName,
    flags: SYSTEMD_RUN_FLAGS,
    properties: SYSTEMD_RUN_PROPERTIES,
  });
}

/**
 * Schedules a shell script file via a transient systemd unit.
 * Environment variables are injected cleanly via --setenv instead of being
 * interpolated into a command string.
 */
async function scheduleSystemScript(
  scriptPath: string,
  unitName: string,
  env: Record<string, string>,
) {
  await systemd.runDetachedScript(scriptPath, {
    unit: unitName,
    env,
    flags: SYSTEMD_RUN_FLAGS,
    properties: SYSTEMD_RUN_PROPERTIES,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function isSystemdAvailable(): Promise<boolean> {
  return systemd.isAvailable();
}

export function scheduleSystemReboot() {
  return scheduleSystemCommand("sleep 2; systemctl reboot", `homeio-reboot-${Date.now()}`);
}

export function scheduleSystemShutdown() {
  return scheduleSystemCommand("sleep 2; systemctl poweroff", `homeio-shutdown-${Date.now()}`);
}

export async function scheduleFactoryReset() {
  const scriptPath = path.join(process.cwd(), "scripts", "factory-reset.sh");

  // Fail fast with a clear error before accepting the request — avoids the user
  // being redirected to the factory-reset screen when nothing will happen.
  try {
    await stat(scriptPath);
  } catch {
    throw new Error(`Factory reset script not found at ${scriptPath}.`);
  }

  const dataRoot = resolveDataRootDirectory();
  const stacksRoot = resolveStoreStacksRoot();
  const storeConfigRoot = resolveStoreConfigDirectory();
  const workdir = process.cwd();

  // Resolve the npm binary at schedule time so the script never relies on PATH
  // inside the restricted systemd environment.
  // An empty answer means `which` found nothing, and it used to reach the
  // fallback only because reading `.stdout` of an undefined result threw.
  // Say it outright instead of depending on an exception.
  const npmBin = await run("which", ["npm"])
    .then((result) => result.stdout.trim() || "npm")
    .catch(() => "npm");

  return scheduleSystemScript(
    scriptPath,
    `homeio-factory-reset-${Date.now()}`,
    {
      DATABASE_URL: serverEnv.DATABASE_URL,
      HOMEIO_RESET_DATA_ROOT: dataRoot,
      HOMEIO_RESET_STACKS_ROOT: stacksRoot,
      HOMEIO_RESET_STORE_CONFIG_ROOT: storeConfigRoot,
      HOMEIO_RESET_WORKDIR: workdir,
      HOMEIO_RESET_NPM_BIN: npmBin,
    },
  );
}

export async function deleteFactoryResetArtifacts() {
  await rm(FACTORY_RESET_LOG_PATH, { force: true }).catch(() => undefined);
}
