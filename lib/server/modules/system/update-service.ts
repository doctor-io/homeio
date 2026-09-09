import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { logServerAction, withServerTiming } from "@/lib/server/logging/logger";
import type {
  SystemUpdateApplyAcceptedResponse,
  SystemUpdateStatus,
} from "@/lib/shared/contracts/system";

const execFileAsync = promisify(execFile);

const DEFAULT_REPO_URL = process.env.HOMEIO_REPO_URL ?? "https://github.com/doctor-io/homeio.git";
const DEFAULT_REPO_BRANCH = process.env.HOMEIO_REPO_BRANCH ?? "main";
const UPDATE_LOG_PATH = "/var/log/homeio-self-update.log";

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
    await execFileAsync("which", ["systemd-run"]);
  } catch {
    throw new Error(
      "systemd-run is not available on this host. Automated in-app update requires systemd. Please update Homeio manually or via git pull.",
    );
  }

  // Guard against concurrent updates. Two simultaneous update runs would race
  // on the same git working tree, npm install, and migration steps.
  try {
    const { stdout } = await execFileAsync("systemctl", [
      "list-units",
      "--state=activating,active",
      "--no-pager",
      "--no-legend",
      "homeio-self-update-*.service",
    ]);
    if (stdout.trim().length > 0) {
      throw new Error("A system update is already in progress. Wait for it to complete before starting another.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A system update")) {
      throw error;
    }
    // systemctl failure is non-fatal — proceed with scheduling
  }

  const unitName = `homeio-self-update-${Date.now()}`;
  const command = [
    "mkdir -p /var/log",
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
  await execFileAsync("systemd-run", [
    "--quiet",
    "--no-block",
    `--unit=${unitName}`,
    "--collect",
    "--property=Type=exec",
    "--property=KillMode=control-group",
    "--property=TimeoutStopSec=30s",
    "--property=SendSIGKILL=yes",
    "--setenv=HOME=/root",
    "--setenv=PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "bash",
    "-lc",
    command,
  ]);

  return {
    action: "update",
    accepted: true,
  };
}
