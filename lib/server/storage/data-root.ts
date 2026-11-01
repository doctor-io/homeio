import "server-only";

import { serverEnv } from "@/lib/server/env";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export const DATA_SUBDIRECTORIES = [
  "AppData",
  "Documents",
  "Media",
  "Download",
  ".Shared",
  ".Network",
  ".Trash",
] as const;

let resolvedDataRoot: string | null = null;

function resolveConfiguredPath(inputPath: string) {
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);
}

/**
 * The Docker install keeps stacks in their own volume at /stacks, whose parent
 * is "/": the data root is then the folder holding STORE_APP_DATA_ROOT (the
 * mounted /DATA), not the filesystem root.
 */
function stacksSitAtFilesystemRoot() {
  return path.dirname(resolveConfiguredPath(serverEnv.STORE_STACKS_ROOT)) === "/";
}

function resolvePrimaryDataRoot() {
  const stacksParent = path.dirname(resolveConfiguredPath(serverEnv.STORE_STACKS_ROOT));
  if (stacksParent !== "/") return stacksParent;
  const appDataParent = path.dirname(resolveConfiguredPath(serverEnv.STORE_APP_DATA_ROOT));
  return appDataParent === "/" ? stacksParent : appDataParent;
}

/**
 * Where an installed app keeps its data. A Docker install up to 1.11.1 fell
 * back to DATA under the working directory (/app/DATA) for every app; an app
 * installed then has no folder in the mounted data root, and keeps its data
 * where Docker has it.
 */
export function resolveInstalledAppDataRoot(appId: string) {
  const current = resolveStoreAppDataRoot();
  if (!stacksSitAtFilesystemRoot() || existsSync(path.join(current, appId))) return current;
  return path.resolve(process.cwd(), "DATA", "AppData");
}

export function resolveStoreStacksRoot() {
  const configured = resolveConfiguredPath(serverEnv.STORE_STACKS_ROOT);
  if (!resolvedDataRoot) {
    return configured;
  }

  const primaryDataRoot = resolvePrimaryDataRoot();
  if (resolvedDataRoot === primaryDataRoot) {
    return configured;
  }

  return path.join(resolvedDataRoot, "Apps");
}

export function resolveStoreAppDataRoot() {
  const configured = resolveConfiguredPath(serverEnv.STORE_APP_DATA_ROOT);
  if (!resolvedDataRoot) {
    return configured;
  }

  const primaryDataRoot = resolvePrimaryDataRoot();
  if (resolvedDataRoot === primaryDataRoot) {
    return configured;
  }

  return path.join(resolvedDataRoot, "AppData");
}

export function resolveDataRootDirectory() {
  if (resolvedDataRoot) {
    return resolvedDataRoot;
  }
  return path.dirname(resolveStoreStacksRoot());
}

export async function ensureDataRootDirectories() {
  const primaryDataRoot = resolvePrimaryDataRoot();
  const fallbackDataRoot = path.resolve(process.cwd(), "DATA");

  if (primaryDataRoot === "/") {
    console.warn(
      `[Storage] STORE_STACKS_ROOT is set to "${serverEnv.STORE_STACKS_ROOT}" — its parent directory ` +
        `resolves to "/", which is the filesystem root and is not a valid data root. ` +
        `STORE_STACKS_ROOT must be nested at least one level inside a writable volume mount ` +
        `(e.g. /DATA/stacks instead of /stacks). Falling back to ${fallbackDataRoot}.`,
    );
  }

  let dataRoot = primaryDataRoot;

  try {
    // Running as root, mkdir would happily fill "/" itself.
    if (primaryDataRoot === "/") throw new Error("the filesystem root is not a data root");
    await Promise.all(
      DATA_SUBDIRECTORIES.map((name) =>
        mkdir(path.join(primaryDataRoot, name), { recursive: true }),
      ),
    );
    resolvedDataRoot = primaryDataRoot;
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "unknown error";
    console.warn(
      `[Storage] Cannot create directories at ${primaryDataRoot} (${errorMessage}). Falling back to ${fallbackDataRoot}`,
    );

    await Promise.all(
      DATA_SUBDIRECTORIES.map((name) =>
        mkdir(path.join(fallbackDataRoot, name), { recursive: true }),
      ),
    );

    dataRoot = fallbackDataRoot;
    resolvedDataRoot = fallbackDataRoot;
  }

  return {
    dataRoot,
    subdirectories: [...DATA_SUBDIRECTORIES],
  };
}
