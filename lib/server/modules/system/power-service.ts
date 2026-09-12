import "server-only";

import { execFile } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { serverEnv } from "@/lib/server/env";
import { resolveStoreConfigDirectory } from "@/lib/server/modules/store/catalog-config";
import {
  resolveDataRootDirectory,
  resolveStoreStacksRoot,
} from "@/lib/server/storage/data-root";

const execFileAsync = promisify(execFile);

const FACTORY_RESET_LOG_PATH = "/var/log/homeio-factory-reset.log";

// ── Systemd unit helpers ───────────────────────────────────────────────────────

const SYSTEMD_RUN_BASE_ARGS = [
  "--quiet",
  "--no-block",
  "--collect",
  "--property=Type=exec",
  "--property=KillMode=control-group",
  "--property=TimeoutStopSec=30s",
  "--property=SendSIGKILL=yes",
] as const;

/**
 * Schedules a short inline shell command via a transient systemd unit.
 * Used for simple one-liners like reboot and shutdown.
 */
async function scheduleSystemCommand(command: string, unitName: string) {
  await execFileAsync("systemd-run", [
    ...SYSTEMD_RUN_BASE_ARGS,
    `--unit=${unitName}`,
    "bash",
    "-lc",
    command,
  ]);
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
  const envArgs = Object.entries(env).flatMap(([key, value]) => [
    "--setenv",
    `${key}=${value}`,
  ]);

  await execFileAsync("systemd-run", [
    ...SYSTEMD_RUN_BASE_ARGS,
    `--unit=${unitName}`,
    ...envArgs,
    "bash",
    scriptPath,
  ]);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function isSystemdAvailable(): Promise<boolean> {
  try {
    await execFileAsync("systemd-run", ["--version"]);
    return true;
  } catch {
    return false;
  }
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
  const npmBin = await execFileAsync("which", ["npm"])
    .then((r) => r.stdout.trim())
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
