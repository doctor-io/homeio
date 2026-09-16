import "server-only";

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "@/lib/server/env";
import { logServerAction } from "@/lib/server/logging/logger";
import {
  FilesPathError,
  resolvePathWithinFilesRoot,
} from "@/lib/server/modules/files/path-resolver";
import {
  deleteNetworkShareFromDb,
  getNetworkShareByMountPathFromDb,
  getNetworkShareFromDb,
  insertNetworkShareInDb,
  listNetworkSharesFromDb,
  touchNetworkShareInDb,
  type NetworkShareRecord,
} from "@/lib/server/modules/files/network-shares-repository";
import { decryptSecret, encryptSecret } from "@/lib/server/modules/files/secrets";
import * as sharing from "@/lib/server/platform/sharing";
import type {
  CreateNetworkShareRequest,
  DiscoverServersResponse,
  DiscoverSharesResponse,
  FileServiceErrorCode,
  NetworkShare,
  NetworkShareStatus,
} from "@/lib/shared/contracts/files";


const WATCH_INTERVAL_MS = 60_000;

let watcherTimer: NodeJS.Timeout | null = null;
let watcherRunning = false;
let watcherTickInFlight = false;

export class NetworkStorageError extends Error {
  readonly code: FileServiceErrorCode;
  readonly statusCode: number;

  constructor(
    message: string,
    options?: {
      code?: FileServiceErrorCode;
      statusCode?: number;
      cause?: unknown;
    },
  ) {
    super(message, {
      cause: options?.cause,
    });
    this.name = "NetworkStorageError";
    this.code = options?.code ?? "internal_error";
    this.statusCode = options?.statusCode ?? 500;
  }
}

type ResolvedMountPath = {
  rootPath: string;
  relativePath: string;
  absolutePath: string;
};

function sanitizeSegment(input: string, fallback: string) {
  const sanitized = input
    .trim()
    .replace(/[^a-zA-Z0-9\-\.\' \(\)_]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized.length > 0 ? sanitized : fallback;
}

async function resolveMountPath(mountPath: string): Promise<ResolvedMountPath> {
  try {
    const resolved = await resolvePathWithinFilesRoot({
      inputPath: mountPath,
      requiredPrefix: "Network",
      allowHiddenSegments: false,
      allowMissingLeaf: true,
    });

    return {
      rootPath: resolved.rootPath,
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath,
    };
  } catch (error) {
    if (error instanceof FilesPathError) {
      throw new NetworkStorageError(error.message, {
        code: error.code,
        statusCode: error.statusCode,
        cause: error,
      });
    }
    throw error;
  }
}

function mountPathForShare(host: string, share: string) {
  const hostSegment = sanitizeSegment(host, "host");
  const shareSegment = sanitizeSegment(share, "share");
  return path.posix.join("Network", hostSegment, shareSegment);
}

function resolveMountIdentity() {
  const processWithIds = process as NodeJS.Process & {
    geteuid?: () => number;
    getegid?: () => number;
  };

  const uid = serverEnv.FILES_NETWORK_MOUNT_UID
    ?? (typeof processWithIds.geteuid === "function" ? processWithIds.geteuid() : 0);
  const gid = serverEnv.FILES_NETWORK_MOUNT_GID
    ?? (typeof processWithIds.getegid === "function" ? processWithIds.getegid() : 0);

  return {
    uid,
    gid,
  };
}


function mapCommandError(
  error: unknown,
  fallbackMessage: string,
  code: FileServiceErrorCode,
) {
  if (error instanceof NetworkStorageError) return error;

  return new NetworkStorageError(fallbackMessage, {
    code,
    statusCode: code === "share_not_found" ? 404 : 500,
    cause: error,
  });
}

function isCommandUnavailable(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const err = error as {
    code?: string;
    message?: string;
    stderr?: string;
  };

  if (err.code === "ENOENT") return true;

  const combined = `${err.message ?? ""}\n${err.stderr ?? ""}`.toLowerCase();
  return (
    combined.includes("not found") ||
    combined.includes("no such file or directory")
  );
}

function errorText(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const err = error as {
    message?: string;
    stderr?: string | Buffer;
  };
  const stderr =
    typeof err.stderr === "string"
      ? err.stderr
      : Buffer.isBuffer(err.stderr)
        ? err.stderr.toString("utf8")
        : "";
  return `${err.message ?? ""}\n${stderr}`.toLowerCase();
}

function isUnmountMissingError(error: unknown) {
  const text = errorText(error);
  return (
    text.includes("not mounted") ||
    text.includes("is not mounted") ||
    text.includes("not found")
  );
}


async function isMounted(mountPath: string) {
  const resolved = await resolveMountPath(mountPath);

  try {
    if (!(await sharing.isMountPoint(resolved.absolutePath))) {
      throw new Error("not mounted");
    }
    return true;
  } catch {
    return false;
  }
}

async function isShareActive(record: NetworkShareRecord) {
  try {
    return await isMounted(record.mountPath);
  } catch (error) {
    const mappedError =
      error instanceof NetworkStorageError
        ? error
        : mapCommandError(error, "Failed to resolve network share state", "internal_error");

    if (
      mappedError.code === "not_found" ||
      mappedError.code === "invalid_path" ||
      mappedError.code === "path_outside_root"
    ) {
      return false;
    }

    logServerAction({
      level: "warn",
      layer: "service",
      action: "files.network.shares.remove.state",
      status: "error",
      message:
        "Unable to verify whether network share is still mounted; continuing cleanup",
      meta: {
        shareId: record.id,
        mountPath: record.mountPath,
      },
      error,
    });

    return false;
  }
}

function toPublicShare(record: NetworkShareRecord): NetworkShare {
  return {
    id: record.id,
    host: record.host,
    share: record.share,
    username: record.username,
    mountPath: record.mountPath,
  };
}

function toShareStatus(record: NetworkShareRecord, mounted: boolean): NetworkShareStatus {
  return {
    ...toPublicShare(record),
    isMounted: mounted,
  };
}

async function mountShareRecord(record: NetworkShareRecord) {
  const resolved = await resolveMountPath(record.mountPath);
  await mkdir(resolved.absolutePath, {
    recursive: true,
  });

  const alreadyMounted = await isMounted(record.mountPath);
  if (alreadyMounted) {
    return;
  }

  const password = decryptSecret({
    ciphertext: record.passwordCiphertext,
    iv: record.passwordIv,
    tag: record.passwordTag,
  });

  const smbPath = `//${record.host}/${record.share}`;
  const identity = resolveMountIdentity();

  // Write credentials to a temporary file (mode 600) instead of embedding
  // them in the mount command line.  On Linux, /proc/PID/cmdline is readable
  // by all local users, so passing password= as a CLI arg leaks the secret.
  const credsPath = `/tmp/homeio-mount-${randomUUID()}.creds`;
  try {
    await writeFile(
      credsPath,
      `username=${record.username}\npassword=${password}\n`,
      { mode: 0o600 },
    );

    const mountOptions = [
      `credentials=${credsPath}`,
      `uid=${identity.uid}`,
      `gid=${identity.gid}`,
      "iocharset=utf8",
    ].join(",");

    // The credentials file path is fine to log; the options string names it
    // rather than carrying the password, but the rest stays out anyway.
    await sharing.mount(
      ["-t", "cifs", smbPath, resolved.absolutePath, "-o", mountOptions],
      ["-t", "cifs", resolved.absolutePath],
    );
  } finally {
    // Always remove the credentials file — whether mount succeeded or failed.
    await rm(credsPath, { force: true }).catch(() => undefined);
  }
}

async function unmountShareRecord(
  record: NetworkShareRecord,
  options?: {
    tolerateMissing?: boolean;
  },
) {
  const tolerateMissing = options?.tolerateMissing ?? false;
  let resolved: ResolvedMountPath;

  try {
    resolved = await resolveMountPath(record.mountPath);
  } catch (error) {
    const mappedError =
      error instanceof NetworkStorageError
        ? error
        : mapCommandError(error, "Failed to unmount network share", "unmount_failed");
    if (
      tolerateMissing &&
      (mappedError.code === "not_found" ||
        mappedError.code === "invalid_path" ||
        mappedError.code === "path_outside_root")
    ) {
      return;
    }
    throw mappedError;
  }
  const mounted = await isMounted(record.mountPath);

  if (mounted) {
    try {
      await sharing.unmount(resolved.absolutePath);
    } catch (error) {
      if (!isUnmountMissingError(error)) {
        throw error;
      }
    }
  }

  try {
    await rm(resolved.absolutePath, {
      recursive: true,
      force: true,
    });
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (
      !tolerateMissing ||
      (nodeError?.code !== "ENOENT" && nodeError?.code !== "ENOTDIR")
    ) {
      throw error;
    }
  }

  const hostDirectory = path.dirname(resolved.absolutePath);
  try {
    const entries = await readdir(hostDirectory);
    if (entries.length === 0) {
      await rm(hostDirectory, {
        recursive: false,
        force: true,
      });
    }
  } catch {
    // ignored
  }
}

async function runWatcherTick() {
  if (watcherTickInFlight) return;
  watcherTickInFlight = true;

  try {
    const shares = await listNetworkSharesFromDb();
    await Promise.all(
      shares.map(async (share) => {
        try {
          const mounted = await isMounted(share.mountPath);
          if (!mounted) {
            await mountShareRecord(share);
            await touchNetworkShareInDb(share.id);
          }
        } catch (error) {
          logServerAction({
            level: "warn",
            layer: "service",
            action: "files.network.watch.mount",
            status: "error",
            message: "Failed to mount network share during watcher tick",
            meta: {
              shareId: share.id,
              mountPath: share.mountPath,
            },
            error,
          });
        }
      }),
    );
  } finally {
    watcherTickInFlight = false;
  }
}

export function startNetworkStorageWatcher() {
  if (watcherRunning) return;

  watcherRunning = true;
  watcherTimer = setInterval(() => {
    void runWatcherTick();
  }, WATCH_INTERVAL_MS);
  watcherTimer.unref?.();
  void runWatcherTick();
}

export async function stopNetworkStorageWatcher() {
  watcherRunning = false;

  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
  }
}

export async function getShareInfo(): Promise<NetworkShareStatus[]> {
  const shares = await listNetworkSharesFromDb();

  const statuses = await Promise.all(
    shares.map(async (share) => {
      let mounted = false;
      try {
        mounted = await isMounted(share.mountPath);
      } catch (error) {
        logServerAction({
          level: "warn",
          layer: "service",
          action: "files.network.shares.get.status",
          status: "error",
          message: "Failed to resolve network share mount status",
          meta: {
            shareId: share.id,
            mountPath: share.mountPath,
          },
          error,
        });
      }
      return toShareStatus(share, mounted);
    }),
  );

  return statuses;
}

export async function addShare(input: CreateNetworkShareRequest) {
  const host = input.host.trim();
  const share = input.share.trim();
  const username = input.username.trim();
  const password = input.password;

  if (!host || !share || !username || !password) {
    throw new NetworkStorageError("Invalid share payload", {
      code: "invalid_path",
      statusCode: 400,
    });
  }

  const mountPath = mountPathForShare(host, share);
  const existing = await getNetworkShareByMountPathFromDb(mountPath);
  if (existing) {
    throw new NetworkStorageError("Network share already exists", {
      code: "share_exists",
      statusCode: 409,
    });
  }

  const encrypted = encryptSecret(password);
  const created = await insertNetworkShareInDb({
    id: randomUUID(),
    host,
    share,
    username,
    mountPath,
    passwordCiphertext: encrypted.ciphertext,
    passwordIv: encrypted.iv,
    passwordTag: encrypted.tag,
  });

  try {
    await mountShareRecord(created);
    await touchNetworkShareInDb(created.id);

    return {
      ...toPublicShare(created),
      isMounted: true,
    } satisfies NetworkShareStatus;
  } catch (error) {
    try {
      await deleteNetworkShareFromDb(created.id);
    } catch (rollbackError) {
      throw new NetworkStorageError(
        "Failed to mount network share and rollback reservation",
        {
          code: "internal_error",
          statusCode: 500,
          cause: {
            error,
            rollbackError,
          },
        },
      );
    }
    throw mapCommandError(error, "Failed to mount network share", "mount_failed");
  }
}

export async function removeShare(shareId: string) {
  const share = await getNetworkShareFromDb(shareId);
  if (!share) {
    throw new NetworkStorageError("Network share not found", {
      code: "share_not_found",
      statusCode: 404,
    });
  }

  try {
    await unmountShareRecord(share, {
      tolerateMissing: true,
    });
  } catch (error) {
    const mappedError = mapCommandError(
      error,
      "Failed to unmount network share",
      "unmount_failed",
    );
    const tolerateCleanupError =
      mappedError.code === "not_found" ||
      mappedError.code === "invalid_path" ||
      mappedError.code === "path_outside_root";

    if (!tolerateCleanupError) {
      const stillMounted = await isShareActive(share);
      if (stillMounted) {
        throw mappedError;
      }
    }

    logServerAction({
      level: "warn",
      layer: "service",
      action: "files.network.shares.remove.cleanup",
      status: "error",
      message: "Network share cleanup was already complete; removing stale DB record",
      meta: {
        shareId: share.id,
        mountPath: share.mountPath,
      },
      error,
    });
  }

  await deleteNetworkShareFromDb(share.id);
  return {
    removed: true,
    id: share.id,
  };
}

export async function mountShare(shareId: string) {
  const share = await getNetworkShareFromDb(shareId);
  if (!share) {
    throw new NetworkStorageError("Network share not found", {
      code: "share_not_found",
      statusCode: 404,
    });
  }

  try {
    await mountShareRecord(share);
    const updated = (await touchNetworkShareInDb(share.id)) ?? share;
    return toShareStatus(updated, true);
  } catch (error) {
    throw mapCommandError(error, "Failed to mount network share", "mount_failed");
  }
}

export async function unmountShare(shareId: string) {
  const share = await getNetworkShareFromDb(shareId);
  if (!share) {
    throw new NetworkStorageError("Network share not found", {
      code: "share_not_found",
      statusCode: 404,
    });
  }

  try {
    await unmountShareRecord(share);
    const updated = (await touchNetworkShareInDb(share.id)) ?? share;
    return toShareStatus(updated, false);
  } catch (error) {
    throw mapCommandError(error, "Failed to unmount network share", "unmount_failed");
  }
}

export async function discoverServers(): Promise<DiscoverServersResponse> {
  try {
    const { stdout } = await sharing.avahiBrowse([
      "--resolve",
      "--terminate",
      "_smb._tcp",
      "--parsable",
    ]);

    // The platform wrapper always hands back a string.
    const output = stdout;
    const servers = output
      .split("\n")
      .map((line) => line.split(";")[6]?.trim() ?? "")
      .filter((value) => value.length > 0);

    return {
      servers: Array.from(new Set(servers)).sort((a, b) =>
        a.localeCompare(b),
      ),
    };
  } catch (error) {
    if (isCommandUnavailable(error)) {
      logServerAction({
        level: "warn",
        layer: "service",
        action: "files.network.discover.servers.unavailable",
        status: "error",
        message: "SMB server discovery command is unavailable",
        error,
      });
      return { servers: [] };
    }

    throw mapCommandError(error, "Failed to discover SMB servers", "internal_error");
  }
}

export async function discoverShares(input: {
  host: string;
  username: string;
  password: string;
}): Promise<DiscoverSharesResponse> {
  const host = input.host.trim();
  const username = input.username.trim();
  const password = input.password;

  if (!host || !username || !password) {
    throw new NetworkStorageError("Invalid share discovery payload", {
      code: "invalid_path",
      statusCode: 400,
    });
  }

  try {
    const { stdout } = await sharing.smbclient([
      "--list",
      `//${host}`,
      "--user",
      username,
      "--password",
      password,
      "--grepable",
    ]);

    // The platform wrapper always hands back a string.
    const output = stdout;
    const shares = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => line.split("|").length === 3)
      .map((line) => line.split("|")[1]?.trim() ?? "")
      .filter((shareName) => shareName.length > 0 && shareName !== "IPC$");

    return {
      shares: Array.from(new Set(shares)).sort((a, b) =>
        a.localeCompare(b),
      ),
    };
  } catch (error) {
    if (isCommandUnavailable(error)) {
      logServerAction({
        level: "warn",
        layer: "service",
        action: "files.network.discover.shares.unavailable",
        status: "error",
        message: "SMB share discovery command is unavailable",
        meta: { host },
        error,
      });
      return { shares: [] };
    }

    throw mapCommandError(
      error,
      "Failed to discover SMB shares for host",
      "internal_error",
    );
  }
}

export async function isShareMounted(shareId: string) {
  const share = await getNetworkShareFromDb(shareId);
  if (!share) {
    throw new NetworkStorageError("Network share not found", {
      code: "share_not_found",
      statusCode: 404,
    });
  }

  const mounted = await isMounted(share.mountPath);
  return toShareStatus(share, mounted);
}

export async function assertMountPathIsSafe(mountPath: string) {
  const resolved = await resolveMountPath(mountPath);
  const info = await lstat(resolved.absolutePath).catch(() => null);
  if (info?.isSymbolicLink()) {
    throw new NetworkStorageError("Symlinks are not allowed", {
      code: "symlink_blocked",
      statusCode: 403,
    });
  }

  return resolved;
}
