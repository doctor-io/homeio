import "server-only";

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { logServerAction } from "@/lib/server/logging/logger";
import * as sharing from "@/lib/server/platform/sharing";
import { isCommandMissing } from "@/lib/server/platform/process";
import {
  deleteLocalShareFromDb,
  getLocalShareBySourcePathFromDb,
  getLocalShareFromDb,
  insertLocalShareInDb,
  listLocalSharesFromDb,
  type LocalShareRecord,
} from "@/lib/server/modules/files/local-shares-repository";
import {
  FilesPathError,
  resolvePathWithinFilesRoot,
} from "@/lib/server/modules/files/path-resolver";
import type {
  CreateLocalFolderShareRequest,
  FileServiceErrorCode,
  LocalFolderShareStatus,
} from "@/lib/shared/contracts/files";

const PG_UNIQUE_VIOLATION = "23505";
const SHARE_NAME_UNIQUE_CONSTRAINT = "files_local_shares_share_name_idx";
const SOURCE_PATH_UNIQUE_CONSTRAINT = "files_local_shares_source_path_idx";
const SHARED_PATH_UNIQUE_CONSTRAINT = "files_local_shares_shared_path_idx";

type OperationLock = {
  waiters: Array<() => void>;
};

const operationLocks = new Map<string, OperationLock>();

export class LocalSharingError extends Error {
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
    this.name = "LocalSharingError";
    this.code = options?.code ?? "internal_error";
    this.statusCode = options?.statusCode ?? 500;
  }
}

function sanitizeShareName(input: string, fallback: string) {
  const sanitized = input
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 48);
  if (sanitized.length > 0) {
    return sanitized;
  }

  const fallbackSanitized = fallback
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 48);
  return fallbackSanitized.length > 0 ? fallbackSanitized : "shared-folder";
}

function withSuffix(baseName: string, attempt: number) {
  if (attempt <= 0) {
    return baseName;
  }
  return sanitizeShareName(`${baseName}-${attempt + 1}`, baseName);
}


async function isMountPoint(absolutePath: string) {
  try {
    if (!(await sharing.isMountPoint(absolutePath))) {
      throw new Error("not a mount point");
    }
    return true;
  } catch {
    return false;
  }
}

async function isUsersharePresent(shareName: string) {
  try {
    await sharing.netUsershare(["info", shareName]);
    return true;
  } catch {
    return false;
  }
}

function errorText(error: unknown) {
  const maybe = error as {
    message?: string;
    stderr?: string | Buffer;
  };
  const stderr =
    typeof maybe.stderr === "string"
      ? maybe.stderr
      : Buffer.isBuffer(maybe.stderr)
        ? maybe.stderr.toString("utf8")
        : "";
  return `${maybe.message ?? ""}\n${stderr}`.toLowerCase();
}

/** Delegates to the platform, which owns the error type. */
function isCommandUnavailableError(error: unknown) {
  return isCommandMissing(error);
}

function isPermissionError(error: unknown) {
  const maybe = error as NodeJS.ErrnoException;
  if (maybe?.code === "EACCES" || maybe?.code === "EPERM") {
    return true;
  }
  const text = errorText(error);
  return (
    text.includes("permission denied") ||
    text.includes("access denied") ||
    text.includes("operation not permitted")
  );
}

function isUsershareMissingError(error: unknown) {
  const text = errorText(error);
  return (
    text.includes("does not exist") ||
    text.includes("not found") ||
    text.includes("unknown service") ||
    text.includes("no such file")
  );
}

function isMountMissingError(error: unknown) {
  const text = errorText(error);
  return (
    text.includes("not mounted") ||
    text.includes("is not mounted") ||
    text.includes("no mount point specified") ||
    text.includes("no such file") ||
    text.includes("not found")
  );
}

function isMountBusyError(error: unknown) {
  const text = errorText(error);
  return text.includes("target is busy") || text.includes("device or resource busy");
}

function isPathCleanupNotRequiredError(error: unknown) {
  if (!(error instanceof FilesPathError)) {
    return false;
  }

  return (
    error.code === "not_found" ||
    error.code === "invalid_path" ||
    error.code === "path_outside_root"
  );
}

type ConstraintConflict = "share_name" | "source_path" | "shared_path" | null;

function getUniqueConflict(error: unknown): ConstraintConflict {
  const maybe = error as {
    code?: unknown;
    constraint?: unknown;
    detail?: unknown;
    message?: unknown;
  };
  if (maybe?.code !== PG_UNIQUE_VIOLATION) {
    return null;
  }

  const constraint =
    typeof maybe.constraint === "string" ? maybe.constraint : "";
  const detail = typeof maybe.detail === "string" ? maybe.detail : "";
  const message = typeof maybe.message === "string" ? maybe.message : "";
  const combined = `${constraint}\n${detail}\n${message}`.toLowerCase();

  if (
    combined.includes(SOURCE_PATH_UNIQUE_CONSTRAINT) ||
    combined.includes("source_path")
  ) {
    return "source_path";
  }
  if (
    combined.includes(SHARE_NAME_UNIQUE_CONSTRAINT) ||
    combined.includes("share_name")
  ) {
    return "share_name";
  }
  if (
    combined.includes(SHARED_PATH_UNIQUE_CONSTRAINT) ||
    combined.includes("shared_path")
  ) {
    return "shared_path";
  }
  return null;
}

async function acquireOperationLock(key: string) {
  const existing = operationLocks.get(key);
  if (!existing) {
    operationLocks.set(key, {
      waiters: [],
    });
    return;
  }

  await new Promise<void>((resolve) => {
    existing.waiters.push(resolve);
  });
}

function releaseOperationLock(key: string) {
  const state = operationLocks.get(key);
  if (!state) return;

  const next = state.waiters.shift();
  if (next) {
    next();
    return;
  }

  operationLocks.delete(key);
}

async function withOperationLock<T>(key: string, operation: () => Promise<T>) {
  await acquireOperationLock(key);
  try {
    return await operation();
  } finally {
    releaseOperationLock(key);
  }
}

function toShareStatus(
  record: LocalShareRecord,
  state: { isMounted: boolean; isExported: boolean },
): LocalFolderShareStatus {
  return {
    id: record.id,
    shareName: record.shareName,
    sourcePath: record.sourcePath,
    sharedPath: record.sharedPath,
    isMounted: state.isMounted,
    isExported: state.isExported,
  };
}

function mapFsError(
  error: unknown,
  fallbackMessage: string,
  failureCode: "mount_failed" | "unmount_failed",
) {
  if (error instanceof LocalSharingError) return error;
  if (error instanceof FilesPathError) {
    return new LocalSharingError(error.message, {
      code: error.code,
      statusCode: error.statusCode,
      cause: error,
    });
  }

  const uniqueConflict = getUniqueConflict(error);
  if (uniqueConflict === "source_path") {
    return new LocalSharingError("Folder is already shared", {
      code: "share_exists",
      statusCode: 409,
      cause: error,
    });
  }

  const nodeError = error as NodeJS.ErrnoException;
  if (isCommandUnavailableError(error)) {
    return new LocalSharingError(
      "Required sharing command is unavailable on this server",
      {
        code: failureCode,
        statusCode: 500,
        cause: error,
      },
    );
  }
  if (isPermissionError(error)) {
    const deniedPath =
      typeof nodeError.path === "string" ? nodeError.path : undefined;
    return new LocalSharingError(
      `Permission denied${deniedPath ? `: ${deniedPath}` : ""}`,
      {
        code: "permission_denied",
        statusCode: 403,
        cause: error,
      },
    );
  }
  if (nodeError?.code === "ENOENT") {
    return new LocalSharingError("File or directory not found", {
      code: "not_found",
      statusCode: 404,
      cause: error,
    });
  }

  return new LocalSharingError(fallbackMessage, {
    code: failureCode,
    statusCode: 500,
    cause: error,
  });
}

async function ensureSharedRoot() {
  const resolved = await resolvePathWithinFilesRoot({
    inputPath: "Shared",
    requiredPrefix: "Shared",
    allowHiddenSegments: false,
    allowMissingLeaf: true,
  });
  await mkdir(resolved.absolutePath, {
    recursive: true,
  });
  return resolved;
}

async function resolveSourcePath(pathInput: string) {
  const resolved = await resolvePathWithinFilesRoot({
    inputPath: pathInput,
    allowHiddenSegments: false,
  });

  if (
    resolved.relativePath === "Shared" ||
    resolved.relativePath.startsWith("Shared/")
  ) {
    throw new LocalSharingError("Cannot share from /Shared", {
      code: "invalid_path",
      statusCode: 400,
    });
  }

  const info = await lstat(resolved.absolutePath);
  if (info.isSymbolicLink()) {
    throw new LocalSharingError("Symlinks are not allowed", {
      code: "symlink_blocked",
      statusCode: 403,
    });
  }
  if (!info.isDirectory()) {
    throw new LocalSharingError("Only folders can be shared", {
      code: "not_a_directory",
      statusCode: 400,
    });
  }

  return resolved;
}

async function resolveExportPath(sharedPath: string) {
  return resolvePathWithinFilesRoot({
    inputPath: sharedPath,
    requiredPrefix: "Shared",
    allowHiddenSegments: false,
    allowMissingLeaf: true,
  });
}

async function ensureShareMounted(sourceAbsolutePath: string, exportAbsolutePath: string) {
  await mkdir(exportAbsolutePath, {
    recursive: true,
  });
  const mounted = await isMountPoint(exportAbsolutePath);
  if (!mounted) {
    await sharing.bindMount(sourceAbsolutePath, exportAbsolutePath);
  }
}

async function ensureUsershareExported(shareName: string, exportAbsolutePath: string) {
  const exported = await isUsersharePresent(shareName);
  if (!exported) {
    await sharing.netUsershare([
      "add",
      shareName,
      exportAbsolutePath,
      "Home Server shared folder",
      "Everyone:F",
      "guest_ok=y",
    ]);
  }
}

async function releaseShareExport(
  record: LocalShareRecord,
  options?: {
    tolerateMissing?: boolean;
  },
) {
  const tolerateMissing = options?.tolerateMissing ?? false;
  let exportResolved: Awaited<ReturnType<typeof resolveExportPath>>;

  try {
    exportResolved = await resolveExportPath(record.sharedPath);
  } catch (error) {
    if (tolerateMissing && isPathCleanupNotRequiredError(error)) {
      return;
    }
    throw error;
  }

  const usershareExists = tolerateMissing
    ? await isUsersharePresent(record.shareName)
    : true;
  const mountExists = tolerateMissing
    ? await isMountPoint(exportResolved.absolutePath)
    : true;
  let usershareDeleteFailed = false;

  if (usershareExists) {
    try {
      await sharing.netUsershare(["delete", record.shareName]);
    } catch (error) {
      if (tolerateMissing && isUsershareMissingError(error)) {
        // Already deleted by an out-of-band cleanup.
      } else if (tolerateMissing && !mountExists && isPermissionError(error)) {
        // If the bind mount is already gone, treat usershare delete permission issues
        // as a stale export entry and keep converging local state.
        usershareDeleteFailed = true;
      } else {
        throw error;
      }
    }
  }

  if (mountExists) {
    try {
      await sharing.unmount(exportResolved.absolutePath);
    } catch (error) {
      if (tolerateMissing && isMountMissingError(error)) {
        // Already unmounted or mount path no longer exists.
      } else if (isMountBusyError(error)) {
        try {
          // Busy bind mounts can require lazy unmount to detach cleanly.
          await sharing.unmount(exportResolved.absolutePath, { lazy: true });
        } catch (lazyError) {
          if (!(tolerateMissing && isMountMissingError(lazyError))) {
            throw lazyError;
          }
        }
      } else {
        throw error;
      }
    }
  }

  // Safety guard: never remove the exported directory while it is still mounted.
  const mountedAfterCleanup = await isMountPoint(exportResolved.absolutePath).catch(
    () => false,
  );
  if (mountedAfterCleanup) {
    throw new Error("Failed to unmount shared folder export");
  }

  try {
    await rm(exportResolved.absolutePath, {
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

  const sharedRoot = path.dirname(exportResolved.absolutePath);
  try {
    const entries = await readdir(sharedRoot);
    if (entries.length === 0) {
      await rm(sharedRoot, {
        recursive: false,
        force: true,
      });
    }
  } catch {
    // ignored
  }

  if (usershareDeleteFailed) {
    const usershareStillPresent = await isUsersharePresent(record.shareName).catch(
      () => false,
    );
    if (usershareStillPresent) {
      return;
    }
  }
}

async function getShareExportState(record: LocalShareRecord): Promise<{
  isMounted: boolean;
  isExported: boolean;
}> {
  const exportResolved = await resolveExportPath(record.sharedPath);
  const [isMounted, isExported] = await Promise.all([
    isMountPoint(exportResolved.absolutePath),
    isUsersharePresent(record.shareName),
  ]);
  return { isMounted, isExported };
}

async function getShareExportActivity(record: LocalShareRecord) {
  try {
    const state = await getShareExportState(record);
    return {
      active: state.isMounted || state.isExported,
      isMounted: state.isMounted,
      isExported: state.isExported,
      unknown: false,
    };
  } catch (error) {
    if (isPathCleanupNotRequiredError(error)) {
      return {
        active: false,
        isMounted: false,
        isExported: false,
        unknown: false,
      };
    }

    logServerAction({
      level: "warn",
      layer: "service",
      action: "files.local-share.remove.state",
      status: "error",
      message:
        "Unable to verify whether a shared folder export is still active; continuing cleanup",
      meta: {
        shareId: record.id,
        sourcePath: record.sourcePath,
        sharedPath: record.sharedPath,
      },
      error,
    });
    return {
      active: false,
      isMounted: false,
      isExported: false,
      unknown: true,
    };
  }
}

async function reserveLocalShare(
  sourceRelativePath: string,
  preferredName: string,
) {
  const baseName = sanitizeShareName(preferredName, "shared-folder");

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidateName = withSuffix(baseName, attempt);
    const candidatePath = path.posix.join("Shared", candidateName);
    try {
      return await insertLocalShareInDb({
        id: randomUUID(),
        shareName: candidateName,
        sourcePath: sourceRelativePath,
        sharedPath: candidatePath,
      });
    } catch (error) {
      const conflict = getUniqueConflict(error);
      if (conflict === "source_path") {
        throw new LocalSharingError("Folder is already shared", {
          code: "share_exists",
          statusCode: 409,
          cause: error,
        });
      }
      if (conflict === "share_name" || conflict === "shared_path") {
        continue;
      }
      throw error;
    }
  }

  throw new LocalSharingError("Unable to allocate a unique share name", {
    code: "share_exists",
    statusCode: 409,
  });
}

async function resolveShareState(
  record: LocalShareRecord,
  caches: {
    mountStateByPath: Map<string, Promise<boolean>>;
    usershareStateByName: Map<string, Promise<boolean>>;
  },
) {
  const exportResolved = await resolveExportPath(record.sharedPath);

  let mountedPromise = caches.mountStateByPath.get(exportResolved.absolutePath);
  if (!mountedPromise) {
    mountedPromise = isMountPoint(exportResolved.absolutePath);
    caches.mountStateByPath.set(exportResolved.absolutePath, mountedPromise);
  }

  let exportedPromise = caches.usershareStateByName.get(record.shareName);
  if (!exportedPromise) {
    exportedPromise = isUsersharePresent(record.shareName);
    caches.usershareStateByName.set(record.shareName, exportedPromise);
  }

  const [isMounted, isExported] = await Promise.all([
    mountedPromise,
    exportedPromise,
  ]);
  return {
    isMounted,
    isExported,
  };
}

export async function listLocalFolderShares(): Promise<LocalFolderShareStatus[]> {
  const records = await listLocalSharesFromDb();
  const caches = {
    mountStateByPath: new Map<string, Promise<boolean>>(),
    usershareStateByName: new Map<string, Promise<boolean>>(),
  };

  return Promise.all(
    records.map(async (record) => {
      const state = await resolveShareState(record, caches);
      return toShareStatus(record, state);
    }),
  );
}

export async function addLocalFolderShare(
  input: CreateLocalFolderShareRequest,
): Promise<LocalFolderShareStatus> {
  try {
    const source = await resolveSourcePath(input.path);

    return await withOperationLock(`source:${source.relativePath}`, async () => {
      const existingBySource = await getLocalShareBySourcePathFromDb(
        source.relativePath,
      );
      if (existingBySource) {
        throw new LocalSharingError("Folder is already shared", {
          code: "share_exists",
          statusCode: 409,
        });
      }

      await ensureSharedRoot();

      const sourceBaseName = path.posix.basename(source.relativePath || "share");
      const preferredName = sanitizeShareName(
        input.name ?? sourceBaseName,
        sourceBaseName,
      );
      const reserved = await reserveLocalShare(source.relativePath, preferredName);

      try {
        const exportTarget = await resolveExportPath(reserved.sharedPath);
        await ensureShareMounted(source.absolutePath, exportTarget.absolutePath);
        await ensureUsershareExported(
          reserved.shareName,
          exportTarget.absolutePath,
        );

        return toShareStatus(reserved, {
          isMounted: true,
          isExported: true,
        });
      } catch (error) {
        let rollbackError: unknown | null = null;
        let dbRollbackError: unknown | null = null;
        try {
          await releaseShareExport(reserved, {
            tolerateMissing: true,
          });
        } catch (rollbackFailure) {
          rollbackError = rollbackFailure;
        }
        try {
          await deleteLocalShareFromDb(reserved.id);
        } catch (deleteFailure) {
          dbRollbackError = deleteFailure;
        }

        if (dbRollbackError) {
          throw new LocalSharingError(
            "Failed to share folder and rollback reserved state",
            {
              code: "internal_error",
              statusCode: 500,
              cause: {
                error,
                rollbackError,
                dbRollbackError,
              },
            },
          );
        }

        if (rollbackError) {
          const mappedError = mapFsError(error, "Failed to share folder", "mount_failed");
          if (mappedError.code !== "internal_error") {
            throw mappedError;
          }

          throw new LocalSharingError(
            "Failed to share folder and rollback partial state",
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

        throw error;
      }
    });
  } catch (error) {
    throw mapFsError(error, "Failed to share folder", "mount_failed");
  }
}

export async function removeLocalFolderShare(shareId: string) {
  return withOperationLock(`share:${shareId}`, async () => {
    const record = await getLocalShareFromDb(shareId);
    if (!record) {
      throw new LocalSharingError("Shared folder not found", {
        code: "share_not_found",
        statusCode: 404,
      });
    }

    try {
      await releaseShareExport(record, {
        tolerateMissing: true,
      });
    } catch (error) {
      const mappedError = mapFsError(
        error,
        "Failed to remove shared folder",
        "unmount_failed",
      );
      const tolerateCleanupError =
        mappedError.code === "not_found" ||
        mappedError.code === "invalid_path" ||
        mappedError.code === "path_outside_root";
      if (!tolerateCleanupError) {
        const activity = await getShareExportActivity(record);
        const stillMounted = activity.isMounted;
        if (stillMounted) {
          throw mappedError;
        }
      }

      logServerAction({
        level: "warn",
        layer: "service",
        action: "files.local-share.remove.cleanup",
        status: "error",
        message: "Share cleanup was already complete; removing stale DB record",
        meta: {
          shareId: record.id,
          sourcePath: record.sourcePath,
          sharedPath: record.sharedPath,
          toleratedCode: mappedError.code,
        },
        error,
      });
    }

    await deleteLocalShareFromDb(record.id);

    return {
      removed: true,
      id: record.id,
    };
  });
}
