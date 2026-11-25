import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { compare, prerelease, valid } from "semver";
import { logServerAction, withServerTiming } from "@/lib/server/logging/logger";
import { readUpdateChannel, writeUpdateChannel } from "@/lib/server/modules/system/update-channel-repository";
import type {
  SystemUpdateApplyAcceptedResponse,
  SystemUpdateChannel,
  SystemUpdateChannelSettings,
  SystemUpdateStatus,
} from "@/lib/shared/contracts/system";

const execFileAsync = promisify(execFile);

const DEFAULT_REPO_URL = process.env.HOMEIO_REPO_URL ?? "https://github.com/doctor-io/homeio.git";
const UPDATE_LOG_PATH = "/var/log/homeio-self-update.log";
const RELEASE_TAG = /^v?\d{1,3}\.\d{1,3}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,32})?$/;
const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "homeio-update-check",
};
// GitHub allows 60 unauthenticated API calls an hour per IP, and every desktop
// and Settings load asks for the update status. A release a day late is fine;
// a Settings page that fails because GitHub rate-limited us is not.
const LATEST_VERSION_TTL_MS = 60 * 60 * 1000;
// After a failed check with nothing known yet, wait before asking again:
// retrying on every load keeps a rate-limited IP rate-limited.
const FAILED_CHECK_BACKOFF_MS = 5 * 60 * 1000;

type LatestVersion = {
  version: string | null;
  /** When GitHub was actually asked, which is not now when the answer is cached. */
  checkedAt: string;
};

const latestVersionCache = new Map<string, LatestVersion & { expiresAt: number }>();
const latestVersionInFlight = new Map<string, Promise<LatestVersion>>();
const latestVersionFailure = new Map<string, { error: unknown; retryAt: number }>();

export class SystemUpdateConflictError extends Error {
  override name = "SystemUpdateConflictError";
}

/**
 * A server that sets HOMEIO_REPO_BRANCH follows that branch, as before.
 * Everyone else follows published releases, so an update is only offered once
 * its GitHub release and Docker image exist, not the moment a PR lands on main.
 */
function configuredRepoBranch() {
  return process.env.HOMEIO_REPO_BRANCH?.trim() || null;
}

function parseGitHubRepository(repositoryUrl: string) {
  const url = new URL(repositoryUrl.replace(/\.git$/i, ""));

  if (url.hostname !== "github.com") {
    throw new Error("Unsupported repository host for Homeio update checks");
  }

  const [owner, repo] = url.pathname.replace(/^\//, "").split("/");
  if (!owner || !repo) {
    throw new Error("Invalid Homeio repository URL");
  }

  return { owner, repo };
}

function updateChannelDisabledReason() {
  if (configuredRepoBranch()) return "This server follows the branch configured in HOMEIO_REPO_BRANCH.";
  if (isContainerRuntime()) return "Docker installations follow their image tag.";
  return null;
}

export async function getSystemUpdateChannel(): Promise<SystemUpdateChannelSettings> {
  const disabledReason = updateChannelDisabledReason();
  return { channel: disabledReason ? "stable" : await readUpdateChannel(), disabledReason };
}

export async function setSystemUpdateChannel(channel: SystemUpdateChannel): Promise<SystemUpdateChannelSettings> {
  const disabledReason = updateChannelDisabledReason();
  if (disabledReason) throw new SystemUpdateConflictError(disabledReason);
  await writeUpdateChannel(channel);
  return { channel, disabledReason };
}

export function compareVersions(left: string, right: string) {
  const leftVersion = valid(left.trim());
  const rightVersion = valid(right.trim());
  return leftVersion && rightVersion ? compare(leftVersion, rightVersion) : 0;
}

async function readCurrentVersion() {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version?.trim() || "unknown";
}

export function buildRemotePackageJsonUrl(
  repositoryUrl = DEFAULT_REPO_URL,
  branch = configuredRepoBranch() ?? "main",
) {
  const { owner, repo } = parseGitHubRepository(repositoryUrl);
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/package.json`;
}

export function buildRemotePackageJsonApiUrl(
  repositoryUrl = DEFAULT_REPO_URL,
  branch = configuredRepoBranch() ?? "main",
) {
  const { owner, repo } = parseGitHubRepository(repositoryUrl);
  return `https://api.github.com/repos/${owner}/${repo}/contents/package.json?ref=${encodeURIComponent(branch)}`;
}

export function buildLatestReleaseApiUrl(repositoryUrl = DEFAULT_REPO_URL) {
  const { owner, repo } = parseGitHubRepository(repositoryUrl);
  return `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
}

function versionTag(value: unknown) {
  const tag = typeof value === "string" ? value.trim() : "";
  return RELEASE_TAG.test(tag) && valid(tag) ? tag : null;
}

async function fetchBranchVersion(branch: string) {
  const response = await fetch(buildRemotePackageJsonApiUrl(DEFAULT_REPO_URL, branch), {
    cache: "no-store",
    headers: GITHUB_API_HEADERS,
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

/** The tag of the release GitHub marks as Latest, or null before the first release. */
async function fetchLatestReleaseTag() {
  const response = await fetch(buildLatestReleaseApiUrl(), {
    cache: "no-store",
    headers: GITHUB_API_HEADERS,
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to fetch the latest Homeio release (${response.status})`);
  }

  const parsed = (await response.json()) as { tag_name?: unknown };
  // The tag becomes a git ref for update.sh, so only accept a version tag.
  const tag = versionTag(parsed.tag_name);
  if (!tag || prerelease(tag)) {
    throw new Error("The latest Homeio release does not have a version tag for a stable release");
  }

  return tag;
}

async function fetchBetaReleaseTag() {
  const { owner, repo } = parseGitHubRepository(DEFAULT_REPO_URL);
  const endpoint = `https://api.github.com/repos/${owner}/${repo}/releases`;
  let latest: string | null = null;
  for (let page = 1; ; page += 1) {
    const response = await fetch(`${endpoint}?per_page=100&page=${page}`, {
      cache: "no-store",
      headers: GITHUB_API_HEADERS,
    });
    if (response.status === 404) return latest;
    if (!response.ok) {
      throw new Error(`Failed to fetch Homeio releases (${response.status})`);
    }
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error("Invalid Homeio releases response");

    for (const release of releases) {
      if (release?.draft !== false) continue;
      const tag = versionTag(release.tag_name);
      if (!tag || release.prerelease !== (prerelease(tag) !== null)) continue;
      if (latest === null || compare(tag, latest) > 0) latest = tag;
    }
    if (!response.headers.get("link")?.includes('rel="next"')) return latest;
  }
}

function fetchReleaseTag(channel: SystemUpdateChannel) {
  return channel === "beta" ? fetchBetaReleaseTag() : fetchLatestReleaseTag();
}

/**
 * The latest version, remembered for an hour. When GitHub cannot be reached the
 * last known answer is served instead of an error, unless the caller asked for
 * a fresh check (the "Check now" button), which must report the failure.
 */
async function getLatestVersion({ refresh = false } = {}): Promise<LatestVersion> {
  const branch = configuredRepoBranch();
  const { channel } = await getSystemUpdateChannel();
  const source = branch ? `branch:${branch}` : `release:${channel}`;
  const cached = latestVersionCache.get(source);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached;
  const failure = latestVersionFailure.get(source);
  if (!refresh && !cached && failure && failure.retryAt > Date.now()) throw failure.error;
  // Desktops opening together share one GitHub call.
  const inFlight = latestVersionInFlight.get(source);
  if (!refresh && inFlight) return inFlight;

  const lookup = (branch ? fetchBranchVersion(branch) : fetchReleaseTag(channel))
    .then((versionOrTag) => {
      latestVersionFailure.delete(source);
      const version = branch ? versionOrTag : versionOrTag?.replace(/^v/i, "") ?? null;
      const entry = {
        version,
        checkedAt: new Date().toISOString(),
        expiresAt: Date.now() + LATEST_VERSION_TTL_MS,
      };
      latestVersionCache.set(source, entry);
      return entry;
    })
    .catch((error: unknown) => {
      if (!cached) latestVersionFailure.set(source, { error, retryAt: Date.now() + FAILED_CHECK_BACKOFF_MS });
      if (refresh || !cached) throw error;
      logServerAction({
        level: "warn",
        layer: "service",
        action: "system.updates.latest.stale",
        status: "error",
        error,
        message: "Could not check GitHub for updates; serving the last known version",
      });
      return cached;
    })
    .finally(() => {
      if (latestVersionInFlight.get(source) === lookup) latestVersionInFlight.delete(source);
    });
  if (!refresh) latestVersionInFlight.set(source, lookup);
  return lookup;
}

export function resetUpdateStatusCacheForTests() {
  latestVersionCache.clear();
  latestVersionInFlight.clear();
  latestVersionFailure.clear();
}

export async function getSystemUpdateStatus(
  options: { refresh?: boolean } = {},
): Promise<SystemUpdateStatus> {
  return withServerTiming(
    {
      layer: "service",
      action: "system.updates.status.get",
    },
    async () => {
      const currentVersion = await readCurrentVersion();
      const { version: latestVersion, checkedAt } = await getLatestVersion(options);

      return {
        currentVersion,
        latestVersion,
        updateAvailable: latestVersion !== null && compareVersions(latestVersion, currentVersion) > 0,
        checkedAt,
        canSelfUpdate: !isContainerRuntime(),
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

export async function scheduleSystemUpdate(expectedVersion?: string): Promise<SystemUpdateApplyAcceptedResponse> {
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

  const branch = configuredRepoBranch();
  let targetRef = branch;
  if (!branch) {
    const { channel } = await getSystemUpdateChannel();
    targetRef = await fetchReleaseTag(channel);
    if (!targetRef) {
      throw new Error("There is no published Homeio release to update to yet.");
    }
    const targetVersion = targetRef.replace(/^v/i, "");
    if (expectedVersion !== undefined && targetVersion !== expectedVersion) {
      throw new SystemUpdateConflictError("The available version has changed. Check for updates again.");
    }
    if (compareVersions(targetVersion, await readCurrentVersion()) <= 0) {
      throw new SystemUpdateConflictError("There is no newer Homeio version in the selected update channel.");
    }
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
      targetRef,
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
    // update.sh defaults to main. Without this it would install whatever main
    // holds rather than the version the update check announced.
    `--setenv=HOMEIO_REPO_BRANCH=${targetRef}`,
    `--setenv=HOMEIO_REPO_URL=${DEFAULT_REPO_URL}`,
    "bash",
    "-lc",
    command,
  ]);

  return {
    action: "update",
    accepted: true,
  };
}
