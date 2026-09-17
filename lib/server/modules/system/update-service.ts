import "server-only";

import path from "node:path";
import { existsSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { logServerAction, withServerTiming } from "@/lib/server/logging/logger";
import * as systemd from "@/lib/server/platform/systemd";
import { run } from "@/lib/server/platform/process";
import type {
  SystemUpdateApplyAcceptedResponse,
  SystemUpdateLog,
  SystemUpdateStatus,
} from "@/lib/shared/contracts/system";


const DEFAULT_REPO_URL = process.env.HOMEIO_REPO_URL ?? "https://github.com/doctor-io/homeio.git";
const DEFAULT_REPO_BRANCH = process.env.HOMEIO_REPO_BRANCH ?? "main";
const UPDATE_LOG_PATH =
  process.env.HOMEIO_UPDATE_LOG_PATH ?? "/var/log/homeio-self-update.log";

/**
 * Written to the log before each run. The script appends, so the file holds
 * every update this machine has ever done; the marker is what lets a reader
 * start at the current one instead of replaying history.
 */
const UPDATE_LOG_MARKER = "=== homeio update";

/**
 * How far back to read when no offset is given. Enough for a whole update —
 * they run to a few hundred lines — without loading a log that has been
 * growing since the machine was installed.
 */
const UPDATE_LOG_TAIL_BYTES = 256 * 1024;

function parseVersionParts(version: string) {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => {
      const numeric = Number.parseInt(part, 10);
      return Number.isFinite(numeric) ? numeric : 0;
    });
}

export function compareVersions(left: string, right: string) {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

async function readCurrentVersion() {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version?.trim() || "unknown";
}

export function buildRemotePackageJsonUrl(
  repositoryUrl = DEFAULT_REPO_URL,
  branch = DEFAULT_REPO_BRANCH,
) {
  const normalized = repositoryUrl.replace(/\.git$/i, "");
  const url = new URL(normalized);

  if (url.hostname !== "github.com") {
    throw new Error("Unsupported repository host for Homeio update checks");
  }

  const [owner, repo] = url.pathname.replace(/^\//, "").split("/");
  if (!owner || !repo) {
    throw new Error("Invalid Homeio repository URL");
  }

  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/package.json`;
}

export function buildRemotePackageJsonApiUrl(
  repositoryUrl = DEFAULT_REPO_URL,
  branch = DEFAULT_REPO_BRANCH,
) {
  const normalized = repositoryUrl.replace(/\.git$/i, "");
  const url = new URL(normalized);

  if (url.hostname !== "github.com") {
    throw new Error("Unsupported repository host for Homeio update checks");
  }

  const [owner, repo] = url.pathname.replace(/^\//, "").split("/");
  if (!owner || !repo) {
    throw new Error("Invalid Homeio repository URL");
  }

  return `https://api.github.com/repos/${owner}/${repo}/contents/package.json?ref=${encodeURIComponent(branch)}`;
}

async function fetchLatestVersion() {
  const response = await fetch(buildRemotePackageJsonApiUrl(), {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "homeio-update-check",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Homeio version metadata (${response.status})`);
  }

  const parsed = (await response.json()) as { content?: string; encoding?: string };
  if (parsed.encoding !== "base64" || typeof parsed.content !== "string") {
    throw new Error("Remote Homeio package metadata did not include decodable content");
  }

  const packageJson = JSON.parse(Buffer.from(parsed.content, "base64").toString("utf8")) as {
    version?: string;
  };

  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error("Remote Homeio package metadata did not include a version");
  }

  return packageJson.version.trim();
}

export async function getSystemUpdateStatus(): Promise<SystemUpdateStatus> {
  return withServerTiming(
    {
      layer: "service",
      action: "system.updates.status.get",
    },
    async () => {
      const currentVersion = await readCurrentVersion();
      const latestVersion = await fetchLatestVersion();

      return {
        currentVersion,
        latestVersion,
        updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
        checkedAt: new Date().toISOString(),
      };
    },
  );
}

function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function isContainerRuntime(): boolean {
  if (process.env.HOMEIO_CONTAINER === "true" || process.env.DOCKER === "true") {
    return true;
  }
  try {
    if (existsSync("/.dockerenv")) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function scheduleSystemUpdate(): Promise<SystemUpdateApplyAcceptedResponse> {
  if (isContainerRuntime()) {
    throw new Error(
      "Homeio is running in a Docker container. In-app self-update via systemd is disabled. Please update your container using: docker compose pull && docker compose up -d",
    );
  }

  const updateScriptPath = path.join(process.cwd(), "scripts", "update.sh");

  try {
    await stat(updateScriptPath);
  } catch {
    throw new Error(`Update script not found at ${updateScriptPath}. Cannot schedule Homeio update.`);
  }

  try {
    await run("which", ["systemd-run"]);
  } catch {
    throw new Error(
      "systemd-run is not available on this host. Automated in-app update requires systemd. Please update Homeio manually or via git pull.",
    );
  }

  // Guard against concurrent updates. Two simultaneous update runs would race
  // on the same git working tree, npm install, and migration steps.
  try {
    const running = await systemd.listUnits("homeio-self-update-*.service", [
      "activating",
      "active",
    ]);
    if (running.length > 0) {
      throw new Error("A system update is already in progress. Wait for it to complete before starting another.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A system update")) {
      throw error;
    }
    // systemctl failure is non-fatal — proceed with scheduling
  }

  const unitName = `homeio-self-update-${Date.now()}`;
  // The marker goes in before the script does, so a reader that attaches late
  // — which is every reader, since the page reloads when the service restarts
  // — can still find where this run started.
  const marker = `${UPDATE_LOG_MARKER} ${unitName} ===`;
  const command = [
    "mkdir -p /var/log",
    `echo ${shellEscape(marker)} >> ${shellEscape(UPDATE_LOG_PATH)}`,
    "sleep 2",
    `${shellEscape(updateScriptPath)} >> ${shellEscape(UPDATE_LOG_PATH)} 2>&1`,
  ].join("; ");

  logServerAction({
    layer: "service",
    action: "system.updates.apply.schedule",
    status: "info",
    message: "Scheduling Homeio update",
    meta: {
      unitName,
      updateScriptPath,
    },
  });

  // systemd-run starts a transient unit with a minimal environment. Without
  // HOME, `go build` fails ("GOCACHE is not defined and neither $XDG_CACHE_HOME
  // nor $HOME are defined"); without /usr/local/go on PATH the build can't find
  // the toolchain at all. Set both explicitly so update.sh runs the same way it
  // would in an interactive root shell.
  await systemd.runDetachedCommand(command, {
    unit: unitName,
    flags: ["--quiet", "--collect"],
    properties: [
      "Type=exec",
      "KillMode=control-group",
      "TimeoutStopSec=30s",
      "SendSIGKILL=yes",
    ],
    env: {
      HOME: "/root",
      PATH: "/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    },
  });

  return {
    action: "update",
    accepted: true,
  };
}

/** Whether a transient update unit is still activating or active. */
export async function isUpdateRunning(): Promise<boolean> {
  try {
    const units = await systemd.listUnits("homeio-self-update-*.service", [
      "activating",
      "active",
    ]);
    return units.length > 0;
  } catch {
    // systemctl being unavailable says nothing about the update itself. The
    // caller shows lines either way; "not running" only stops the polling, and
    // the log ending is the better signal for that.
    return false;
  }
}

/**
 * The update log from `fromOffset`, or from the current run when none is given.
 *
 * The offset travels to the caller and back rather than living here, because
 * the thing being watched restarts the process doing the watching: by the time
 * the browser reconnects, any position this module had held is gone.
 */
export async function readUpdateLog(fromOffset?: number): Promise<SystemUpdateLog> {
  const running = await isUpdateRunning();

  if (isContainerRuntime()) {
    return {
      lines: [],
      nextOffset: 0,
      running: false,
      available: false,
      unavailableReason:
        "Homeio runs in a container here, where the in-app updater is disabled. Update with `docker compose pull && docker compose up -d`, and follow `docker compose logs -f`.",
    };
  }

  let size: number;
  try {
    size = (await stat(UPDATE_LOG_PATH)).size;
  } catch {
    return {
      lines: [],
      nextOffset: 0,
      running,
      available: false,
      unavailableReason: "No update has been run on this server yet.",
    };
  }

  // A log that shrank was rotated or truncated under us; the held offset now
  // points into a different file, so start over rather than read garbage.
  const held = typeof fromOffset === "number" && fromOffset >= 0 && fromOffset <= size
    ? fromOffset
    : undefined;

  const start = held ?? Math.max(0, size - UPDATE_LOG_TAIL_BYTES);

  if (start >= size) {
    return { lines: [], nextOffset: size, running, available: true, unavailableReason: null };
  }

  let text: string;
  try {
    const handle = await open(UPDATE_LOG_PATH, "r");
    try {
      const buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);
      text = buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    logServerAction({
      level: "warn",
      layer: "service",
      action: "system.updates.log.read",
      status: "error",
      message: "Could not read the update log",
      error,
    });
    return {
      lines: [],
      nextOffset: held ?? 0,
      running,
      available: false,
      unavailableReason: "The update log could not be read.",
    };
  }

  let lines = text.split("\n");

  // Only when starting fresh: drop everything before the last marker so the
  // caller sees this update rather than every update the machine has done.
  if (held === undefined) {
    const lastMarker = lines.findLastIndex((line) => line.startsWith(UPDATE_LOG_MARKER));
    if (lastMarker >= 0) lines = lines.slice(lastMarker + 1);
  }

  return {
    lines: lines.map((line) => line.trimEnd()).filter((line) => line.length > 0),
    nextOffset: size,
    running,
    available: true,
    unavailableReason: null,
  };
}
