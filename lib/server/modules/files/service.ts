import "server-only";

import {
  cp,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { setImmediate as setImmediatePromise } from "node:timers/promises";
import { serverEnv } from "@/lib/server/env";
import { withServerTiming } from "@/lib/server/logging/logger";
import {
  FilesPathError,
  resolvePathWithinFilesRoot,
  type ResolvedFilesPath,
} from "@/lib/server/modules/files/path-resolver";
import {
  isPathStarredInDb,
  listStarredPathsFromDb,
  setPathStarredInDb,
} from "@/lib/server/modules/files/stars-repository";
import { listTrashEntriesFromDb } from "@/lib/server/modules/files/trash-repository";
import type {
  FileInfoResponse,
  FileListEntry,
  FileListResponse,
  FilePasteOperation,
  FilePasteResponse,
  FileReadMode,
  FileReadResponse,
  FileCreateResponse,
  FileRenameResponse,
  FileServiceErrorCode,
  FileToggleStarResponse,
  FileUnzipResponse,
  FileUploadResponse,
  FileWriteResponse,
} from "@/lib/shared/contracts/files";

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "json", "yaml", "yml", "conf", "env", "log", "csv",
  "sh", "bash", "zsh", "fish",
  "py", "js", "ts", "jsx", "tsx", "mjs", "cjs",
  "css", "scss", "sass", "less",
  "html", "htm", "xml", "svg",
  "sql", "ini", "toml", "cfg",
  "go", "rs", "rb", "php", "kt", "kts", "java",
  "c", "cpp", "cc", "cxx", "h", "hpp",
  "swift", "pl", "pm", "lua", "r", "ex", "exs",
  "dockerfile", "makefile", "gitignore", "gitattributes",
  "editorconfig", "prettierrc", "eslintrc", "babelrc",
  "lock", "gradle", "pom",
]);

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "video/ogg",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  m4v: "video/mp4",
};

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  opus: "audio/opus",
  oga: "audio/ogg",
  weba: "audio/webm",
};

export const MAX_TEXT_READ_BYTES = 2 * 1024 * 1024;

type ListDirectoryParams = {
  path?: string;
  includeHidden?: boolean;
};

type ReadFileForViewerParams = {
  path: string;
  includeHidden?: boolean;
};

type WriteTextFileParams = {
  path: string;
  content: string;
  expectedMtimeMs?: number;
  includeHidden?: boolean;
};

type CreateEntryParams = {
  parentPath?: string;
  name: string;
  includeHidden?: boolean;
};

type PasteEntryParams = {
  sourcePath: string;
  destinationPath?: string;
  operation: FilePasteOperation;
  collision?: "replace" | "keep-both" | "skip";
  includeHidden?: boolean;
};

type RenameEntryParams = {
  path: string;
  newName: string;
  includeHidden?: boolean;
};

type GetEntryInfoParams = {
  path: string;
  includeHidden?: boolean;
};

type ToggleStarEntryParams = {
  path: string;
  includeHidden?: boolean;
};

export class FileServiceError extends Error {
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
    this.name = "FileServiceError";
    this.code = options?.code ?? "internal_error";
    this.statusCode = options?.statusCode ?? 500;
  }
}

function getExtension(fileName: string) {
  const raw = path.extname(fileName).slice(1).toLowerCase();
  return raw.length > 0 ? raw : null;
}

function isHiddenName(name: string) {
  return name.startsWith(".");
}

function isTrashPathSegments(segments: string[]) {
  return segments[0] === "Trash";
}

function mapFsError(
  error: unknown,
  fallbackMessage: string,
  absolutePath?: string,
) {
  if (error instanceof FileServiceError) return error;
  if (error instanceof FilesPathError) {
    return new FileServiceError(error.message, {
      code: error.code,
      statusCode: error.statusCode,
      cause: error,
    });
  }

  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError?.code === "ENOENT") {
    return new FileServiceError("File or directory not found", {
      code: "not_found",
      statusCode: 404,
      cause: error,
    });
  }
  if (nodeError?.code === "ENOTDIR") {
    return new FileServiceError("Path is not a directory", {
      code: "not_a_directory",
      statusCode: 400,
      cause: error,
    });
  }
  if (nodeError?.code === "EISDIR") {
    return new FileServiceError("Path is not a file", {
      code: "not_a_file",
      statusCode: 400,
      cause: error,
    });
  }
  if (nodeError?.code === "EACCES" || nodeError?.code === "EPERM") {
    return new FileServiceError(
      `Permission denied${absolutePath ? `: ${absolutePath}` : ""}`,
      {
        code: "permission_denied",
        statusCode: 403,
        cause: error,
      },
    );
  }
  if (nodeError?.code === "ELOOP") {
    return new FileServiceError("Symlinks are not allowed", {
      code: "symlink_blocked",
      statusCode: 403,
      cause: error,
    });
  }
  if (nodeError?.code === "EEXIST") {
    return new FileServiceError("Destination already exists", {
      code: "destination_exists",
      statusCode: 409,
      cause: error,
    });
  }
  if (nodeError?.code === "EXDEV") {
    return new FileServiceError("Move across filesystem boundaries failed", {
      code: "internal_error",
      statusCode: 500,
      cause: error,
    });
  }

  return new FileServiceError(fallbackMessage, {
    code: "internal_error",
    statusCode: 500,
    cause: error,
  });
}

function isTextExtension(extension: string | null) {
  if (!extension) return false;
  return TEXT_EXTENSIONS.has(extension);
}

export function getMimeTypeForExtension(extension: string | null) {
  if (!extension) return null;
  if (extension in IMAGE_MIME_BY_EXTENSION) return IMAGE_MIME_BY_EXTENSION[extension];
  if (extension in VIDEO_MIME_BY_EXTENSION) return VIDEO_MIME_BY_EXTENSION[extension];
  if (extension in AUDIO_MIME_BY_EXTENSION) return AUDIO_MIME_BY_EXTENSION[extension];
  if (extension === "pdf") return "application/pdf";
  if (TEXT_EXTENSIONS.has(extension)) return "text/plain; charset=utf-8";
  return null;
}

function toViewerMode(extension: string | null): FileReadMode {
  if (!extension) return "binary_unsupported";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  if (extension in IMAGE_MIME_BY_EXTENSION) return "image";
  if (extension === "pdf") return "pdf";
  if (extension in VIDEO_MIME_BY_EXTENSION) return "video";
  if (extension in AUDIO_MIME_BY_EXTENSION) return "audio";
  return "binary_unsupported";
}

function toPublicPath(segments: string[]) {
  return segments.join("/");
}

function toPermissionsString(mode: number) {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

function toEntryType(info: Awaited<ReturnType<typeof lstat>>) {
  if (info.isDirectory()) return "folder" as const;
  if (info.isFile()) return "file" as const;
  return null;
}

function sortDirectoryEntries(entries: FileListEntry[]) {
  return entries.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "folder" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function ensureSafeName(rawName: string, includeHidden: boolean) {
  const name = rawName.trim();
  if (name.length === 0 || name === "." || name === "..") {
    throw new FileServiceError("Invalid path", {
      code: "invalid_path",
      statusCode: 400,
    });
  }
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new FileServiceError("Invalid path", {
      code: "invalid_path",
      statusCode: 400,
    });
  }
  if (!includeHidden && isHiddenName(name)) {
    throw new FileServiceError("Hidden files are not allowed", {
      code: "hidden_blocked",
      statusCode: 403,
    });
  }
  return name;
}

async function pathExists(absolutePath: string) {
  try {
    await lstat(absolutePath);
    return true;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function resolveFilePath(
  inputPath: string | undefined,
  includeHidden: boolean,
  options: {
    allowEmpty?: boolean;
    allowMissingLeaf?: boolean;
  } = {},
) {
  const preResolved = await resolvePathWithinFilesRoot({
    inputPath,
    allowEmpty: options.allowEmpty ?? true,
    allowHiddenSegments: true,
    allowMissingLeaf: options.allowMissingLeaf ?? false,
  });
  if (!includeHidden && !isTrashPathSegments(preResolved.segments)) {
    const hiddenSegment = preResolved.segments.find((segment) =>
      isHiddenName(segment),
    );
    if (hiddenSegment) {
      throw new FileServiceError("Hidden files are not allowed", {
        code: "hidden_blocked",
        statusCode: 403,
      });
    }
  }
  return preResolved;
}

async function assertDirectoryPath(
  inputPath: string | undefined,
  includeHidden: boolean,
  options: { allowEmpty?: boolean } = {},
) {
  const resolved = await resolveFilePath(inputPath, includeHidden, {
    allowEmpty: options.allowEmpty ?? true,
  });
  const info = await lstat(resolved.absolutePath);
  if (info.isSymbolicLink()) {
    throw new FileServiceError("Symlinks are not allowed", {
      code: "symlink_blocked",
      statusCode: 403,
    });
  }
  if (!info.isDirectory()) {
    throw new FileServiceError("Path is not a directory", {
      code: "not_a_directory",
      statusCode: 400,
    });
  }
  return resolved;
}

function joinRelativePath(baseSegments: string[], leafName: string) {
  if (baseSegments.length === 0) return leafName;
  return `${baseSegments.join("/")}/${leafName}`;
}

export async function listDirectory(params: ListDirectoryParams = {}): Promise<FileListResponse> {
  return withServerTiming(
    {
      level: "debug",
      layer: "service",
      action: "files.listDirectory",
      meta: {
        path: params.path ?? "",
        includeHidden: Boolean(params.includeHidden),
      },
      onSuccessMeta: (result) => ({
        entryCount: (result as FileListResponse).entries.length,
      }),
    },
    async () => {
      const includeHidden = Boolean(params.includeHidden);
      let resolved: ResolvedFilesPath | undefined;

      try {
        resolved = await resolveFilePath(params.path, includeHidden);
        const info = await lstat(resolved.absolutePath);
        if (info.isSymbolicLink()) {
          throw new FileServiceError("Symlinks are not allowed", {
            code: "symlink_blocked",
            statusCode: 403,
          });
        }
        if (!info.isDirectory()) {
          throw new FileServiceError("Path is not a directory", {
            code: "not_a_directory",
            statusCode: 400,
          });
        }
      } catch (error) {
        throw mapFsError(
          error,
          "Failed to list directory",
          resolved?.absolutePath,
        );
      }

      try {
        const entries = await readdir(resolved.absolutePath, {
          withFileTypes: true,
        });
        const output: FileListEntry[] = [];
        const listingTrash = isTrashPathSegments(resolved.segments);

        const [starredPathSet, trashMetaMap] = await Promise.all([
          listStarredPathsFromDb().then((paths) => new Set(paths)),
          listingTrash
            ? listTrashEntriesFromDb().then(
                (rows) => new Map(rows.map((r) => [r.trashPath, r])),
              )
            : Promise.resolve(new Map<string, { originalPath: string; deletedAt: Date }>()),
        ]);

        const visibleEntries = entries.filter(
          (entry) => includeHidden || listingTrash || !isHiddenName(entry.name),
        );

        const statResults = await Promise.all(
          visibleEntries.map(async (entry) => {
            const absoluteEntryPath = path.join(resolved.absolutePath, entry.name);
            const info = await lstat(absoluteEntryPath);
            return { entry, info };
          }),
        );

        for (const { entry, info } of statResults) {
          if (info.isSymbolicLink()) continue;

          const type = info.isDirectory() ? "folder" : info.isFile() ? "file" : null;
          if (!type) continue;

          const entryPublicPath = toPublicPath([...resolved.segments, entry.name]);
          const trashMeta = trashMetaMap.get(entryPublicPath);
          output.push({
            name: entry.name,
            path: entryPublicPath,
            type,
            ext: type === "file" ? getExtension(entry.name) : null,
            sizeBytes: type === "file" ? info.size : null,
            modifiedAt: info.mtime.toISOString(),
            mtimeMs: info.mtimeMs,
            starred: starredPathSet.has(entryPublicPath),
            ...(trashMeta && {
              trashOriginalPath: trashMeta.originalPath,
              trashDeletedAt: trashMeta.deletedAt.toISOString(),
            }),
          });
        }

        return {
          root: resolved.rootPath,
          cwd: resolved.relativePath,
          entries: sortDirectoryEntries(output),
        };
      } catch (error) {
        throw mapFsError(
          error,
          "Failed to list directory",
          resolved.absolutePath,
        );
      }
    },
  );
}

export async function readFileForViewer(params: ReadFileForViewerParams): Promise<FileReadResponse> {
  return withServerTiming(
    {
      level: "debug",
      layer: "service",
      action: "files.readFile",
      meta: {
        path: params.path,
        includeHidden: Boolean(params.includeHidden),
      },
      onSuccessMeta: (result) => {
        const response = result as FileReadResponse;
        return {
          mode: response.mode,
          sizeBytes: response.sizeBytes,
        };
      },
    },
    async () => {
      let resolved: ResolvedFilesPath | undefined;
      let info: Awaited<ReturnType<typeof stat>>;

      try {
        resolved = await resolveFilePath(params.path, Boolean(params.includeHidden), {
          allowEmpty: false,
        });
        const linkInfo = await lstat(resolved.absolutePath);
        if (linkInfo.isSymbolicLink()) {
          throw new FileServiceError("Symlinks are not allowed", {
            code: "symlink_blocked",
            statusCode: 403,
          });
        }
        if (!linkInfo.isFile()) {
          throw new FileServiceError("Path is not a file", {
            code: "not_a_file",
            statusCode: 400,
          });
        }
        info = await stat(resolved.absolutePath);
      } catch (error) {
        throw mapFsError(
          error,
          "Failed to open file",
          resolved?.absolutePath,
        );
      }

      const name = path.basename(resolved.absolutePath);
      const ext = getExtension(name);
      const mode = toViewerMode(ext);
      const mimeType = getMimeTypeForExtension(ext);

      if (mode === "text") {
        if (info.size > MAX_TEXT_READ_BYTES) {
          return {
            root: resolved.rootPath,
            path: resolved.relativePath,
            name,
            ext,
            mode: "too_large",
            mimeType,
            sizeBytes: info.size,
            modifiedAt: info.mtime.toISOString(),
            mtimeMs: info.mtimeMs,
            content: null,
          };
        }

        try {
          const content = await readFile(resolved.absolutePath, "utf8");
          return {
            root: resolved.rootPath,
            path: resolved.relativePath,
            name,
            ext,
            mode,
            mimeType,
            sizeBytes: info.size,
            modifiedAt: info.mtime.toISOString(),
            mtimeMs: info.mtimeMs,
            content,
          };
        } catch (error) {
          throw mapFsError(
            error,
            "Failed to read file",
            resolved.absolutePath,
          );
        }
      }

      return {
        root: resolved.rootPath,
        path: resolved.relativePath,
        name,
        ext,
        mode,
        mimeType,
        sizeBytes: info.size,
        modifiedAt: info.mtime.toISOString(),
        mtimeMs: info.mtimeMs,
        content: null,
      };
    },
  );
}

export async function writeTextFile(params: WriteTextFileParams): Promise<FileWriteResponse> {
  return withServerTiming(
    {
      layer: "service",
      action: "files.writeFile",
      meta: {
        path: params.path,
        byteLength: Buffer.byteLength(params.content, "utf8"),
        includeHidden: Boolean(params.includeHidden),
      },
      onSuccessMeta: (result) => ({
        sizeBytes: (result as FileWriteResponse).sizeBytes,
      }),
    },
    async () => {
      const byteLength = Buffer.byteLength(params.content, "utf8");
      if (byteLength > MAX_TEXT_READ_BYTES) {
        throw new FileServiceError("Payload too large", {
          code: "payload_too_large",
          statusCode: 413,
        });
      }

      let resolved: ResolvedFilesPath | undefined;
      let currentInfo: Awaited<ReturnType<typeof stat>>;

      try {
        resolved = await resolveFilePath(params.path, Boolean(params.includeHidden), {
          allowEmpty: false,
        });
        const linkInfo = await lstat(resolved.absolutePath);
        if (linkInfo.isSymbolicLink()) {
          throw new FileServiceError("Symlinks are not allowed", {
            code: "symlink_blocked",
            statusCode: 403,
          });
        }
        if (!linkInfo.isFile()) {
          throw new FileServiceError("Path is not a file", {
            code: "not_a_file",
            statusCode: 400,
          });
        }
        currentInfo = await stat(resolved.absolutePath);
      } catch (error) {
        throw mapFsError(
          error,
          "Failed to save file",
          resolved?.absolutePath,
        );
      }

      const ext = getExtension(path.basename(resolved.absolutePath));
      if (!isTextExtension(ext)) {
        throw new FileServiceError("Unsupported file type for save", {
          code: "unsupported_file",
          statusCode: 415,
        });
      }

      if (
        typeof params.expectedMtimeMs === "number" &&
        Number.isFinite(params.expectedMtimeMs) &&
        currentInfo.mtimeMs !== params.expectedMtimeMs
      ) {
        throw new FileServiceError("File changed since it was opened", {
          code: "write_conflict",
          statusCode: 409,
        });
      }

      try {
        const target = await resolvePathWithinFilesRoot({
          inputPath: params.path,
          allowHiddenSegments: Boolean(params.includeHidden),
        });
        if (target.absolutePath !== resolved.absolutePath) {
          throw new FileServiceError("File changed while resolving target path", {
            code: "write_conflict",
            statusCode: 409,
          });
        }

        await writeFile(resolved.absolutePath, params.content, "utf8");
        const savedInfo = await stat(resolved.absolutePath);
        return {
          root: resolved.rootPath,
          path: resolved.relativePath,
          sizeBytes: savedInfo.size,
          modifiedAt: savedInfo.mtime.toISOString(),
          mtimeMs: savedInfo.mtimeMs,
        };
      } catch (error) {
        throw mapFsError(
          error,
          "Failed to save file",
          resolved.absolutePath,
        );
      }
    },
  );
}

export async function resolveReadableFileAbsolutePath(input: {
  path: string;
  includeHidden?: boolean;
}) {
  let resolved: ResolvedFilesPath | undefined;

  try {
    resolved = await resolveFilePath(input.path, Boolean(input.includeHidden), {
      allowEmpty: false,
    });
    const linkInfo = await lstat(resolved.absolutePath);
    if (linkInfo.isSymbolicLink()) {
      throw new FileServiceError("Symlinks are not allowed", {
        code: "symlink_blocked",
        statusCode: 403,
      });
    }
    if (!linkInfo.isFile()) {
      throw new FileServiceError("Path is not a file", {
        code: "not_a_file",
        statusCode: 400,
      });
    }
  } catch (error) {
    throw mapFsError(
      error,
      "Failed to resolve file",
      resolved?.absolutePath,
    );
  }

  return {
    root: resolved.rootPath,
    path: resolved.relativePath,
    absolutePath: resolved.absolutePath,
  };
}

export async function resolveDownloadableFolderAbsolutePath(input: {
  path: string;
  includeHidden?: boolean;
}) {
  let resolved: ResolvedFilesPath | undefined;

  try {
    resolved = await resolveFilePath(input.path, Boolean(input.includeHidden), {
      allowEmpty: false,
    });
    const linkInfo = await lstat(resolved.absolutePath);
    if (linkInfo.isSymbolicLink()) {
      throw new FileServiceError("Symlinks are not allowed", {
        code: "symlink_blocked",
        statusCode: 403,
      });
    }
    if (!linkInfo.isDirectory()) {
      throw new FileServiceError("Path is not a directory", {
        code: "not_a_directory",
        statusCode: 400,
      });
    }
  } catch (error) {
    throw mapFsError(
      error,
      "Failed to resolve folder",
      resolved?.absolutePath,
    );
  }

  const folderName = path.basename(resolved.absolutePath);
  const parentAbsolutePath = path.dirname(resolved.absolutePath);

  return {
    root: resolved.rootPath,
    path: resolved.relativePath,
    absolutePath: resolved.absolutePath,
    parentAbsolutePath,
    folderName,
  };
}

export async function createDirectoryEntry(
  params: CreateEntryParams,
): Promise<FileCreateResponse> {
  return withServerTiming(
    {
      layer: "service",
      action: "files.createDirectory",
      meta: {
        parentPath: params.parentPath ?? "",
        name: params.name,
        includeHidden: Boolean(params.includeHidden),
      },
    },
    async () => {
      const includeHidden = Boolean(params.includeHidden);
      const name = ensureSafeName(params.name, includeHidden);
      let parentPath: ResolvedFilesPath | undefined;

      try {
        parentPath = await assertDirectoryPath(params.parentPath, includeHidden, {
          allowEmpty: true,
        });
        const relativePath = joinRelativePath(parentPath.segments, name);
        const targetPath = await resolveFilePath(relativePath, includeHidden, {
          allowEmpty: false,
          allowMissingLeaf: true,
        });

        if (targetPath.exists || (await pathExists(targetPath.absolutePath))) {
          throw new FileServiceError("Destination already exists", {
            code: "destination_exists",
            statusCode: 409,
          });
        }

        await mkdir(targetPath.absolutePath, {
          recursive: false,
        });

        return {
          root: targetPath.rootPath,
          path: targetPath.relativePath,
          type: "folder",
        };
      } catch (error) {
        throw mapFsError(error, "Failed to create folder", parentPath?.absolutePath);
      }
    },
  );
}

export async function createFileEntry(
  params: CreateEntryParams,
): Promise<FileCreateResponse> {
  return withServerTiming(
    {
      layer: "service",
      action: "files.createFile",
      meta: {
        parentPath: params.parentPath ?? "",
        name: params.name,
        includeHidden: Boolean(params.includeHidden),
      },
    },
    async () => {
      const includeHidden = Boolean(params.includeHidden);
      const name = ensureSafeName(params.name, includeHidden);
      let parentPath: ResolvedFilesPath | undefined;

      try {
        parentPath = await assertDirectoryPath(params.parentPath, includeHidden, {
          allowEmpty: true,
        });
        const relativePath = joinRelativePath(parentPath.segments, name);
        const targetPath = await resolveFilePath(relativePath, includeHidden, {
          allowEmpty: false,
          allowMissingLeaf: true,
        });

        if (targetPath.exists || (await pathExists(targetPath.absolutePath))) {
          throw new FileServiceError("Destination already exists", {
            code: "destination_exists",
            statusCode: 409,
          });
        }

        await writeFile(targetPath.absolutePath, "", {
          encoding: "utf8",
          flag: "wx",
        });

        return {
          root: targetPath.rootPath,
          path: targetPath.relativePath,
          type: "file",
        };
      } catch (error) {
        throw mapFsError(error, "Failed to create file", parentPath?.absolutePath);
      }
    },
  );
}

async function movePath(
  sourceAbsolutePath: string,
  destinationAbsolutePath: string,
  isDirectory: boolean,
) {
  try {
    await rename(sourceAbsolutePath, destinationAbsolutePath);
    return;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code !== "EXDEV") {
      throw error;
    }
  }

  if (isDirectory) {
    await cp(sourceAbsolutePath, destinationAbsolutePath, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  } else {
    await copyFile(sourceAbsolutePath, destinationAbsolutePath);
  }
  await rm(sourceAbsolutePath, {
    recursive: true,
    force: true,
  });
}

export async function pasteEntry(params: PasteEntryParams): Promise<FilePasteResponse> {
  return withServerTiming(
    {
      layer: "service",
      action: "files.pasteEntry",
      meta: {
        sourcePath: params.sourcePath,
        destinationPath: params.destinationPath ?? "",
        operation: params.operation,
        includeHidden: Boolean(params.includeHidden),
      },
    },
    async () => {
      const includeHidden = Boolean(params.includeHidden);
      let sourcePath: ResolvedFilesPath | undefined;
      let destinationDirectory: ResolvedFilesPath | undefined;
      let targetPath: ResolvedFilesPath | undefined;

      try {
        sourcePath = await resolveFilePath(params.sourcePath, includeHidden, {
          allowEmpty: false,
        });
        const sourceInfo = await lstat(sourcePath.absolutePath);
        if (sourceInfo.isSymbolicLink()) {
          throw new FileServiceError("Symlinks are not allowed", {
            code: "symlink_blocked",
            statusCode: 403,
          });
        }
        if (!sourceInfo.isDirectory() && !sourceInfo.isFile()) {
          throw new FileServiceError("Unsupported file type", {
            code: "unsupported_file",
            statusCode: 415,
          });
        }

        destinationDirectory = await assertDirectoryPath(
          params.destinationPath,
          includeHidden,
          { allowEmpty: true },
        );
        const targetRelativePath = joinRelativePath(
          destinationDirectory.segments,
          path.basename(sourcePath.relativePath),
        );
        targetPath = await resolveFilePath(targetRelativePath, includeHidden, {
          allowEmpty: false,
          allowMissingLeaf: true,
        });

        if (targetPath.absolutePath === sourcePath.absolutePath) {
          throw new FileServiceError("Destination already exists", {
            code: "destination_exists",
            statusCode: 409,
          });
        }

        const targetExists = targetPath.exists || (await pathExists(targetPath.absolutePath));

        if (targetExists) {
          if (!params.collision || params.collision === "skip") {
            if (!params.collision) {
              throw new FileServiceError("Destination already exists", {
                code: "destination_exists",
                statusCode: 409,
              });
            }
            // skip: return the existing path without error
            return {
              root: targetPath.rootPath,
              path: targetPath.relativePath,
              type: sourceInfo.isDirectory() ? "folder" : "file",
            };
          }

          if (params.collision === "keep-both") {
            // Find a unique name: "name (1)", "name (2)", etc.
            const baseName = path.basename(sourcePath.relativePath);
            const ext = sourceInfo.isDirectory() ? "" : path.extname(baseName);
            const stem = sourceInfo.isDirectory() ? baseName : baseName.slice(0, baseName.length - ext.length);
            let counter = 1;
            let uniqueRelativePath: string;
            do {
              const candidate = `${stem} (${counter})${ext}`;
              uniqueRelativePath = joinRelativePath(destinationDirectory.segments, candidate);
              counter++;
            } while (await pathExists(path.join(destinationDirectory.absolutePath, `${stem} (${counter - 1})${ext}`)));
            targetPath = await resolveFilePath(uniqueRelativePath, includeHidden, {
              allowEmpty: false,
              allowMissingLeaf: true,
            });
          } else if (params.collision === "replace") {
            // Delete the existing target first
            await rm(targetPath.absolutePath, { recursive: true, force: true });
          }
        }

        if (
          params.operation === "move" &&
          sourceInfo.isDirectory() &&
          targetPath.relativePath.startsWith(`${sourcePath.relativePath}/`)
        ) {
          throw new FileServiceError("Cannot move folder into itself", {
            code: "invalid_path",
            statusCode: 400,
          });
        }

        if (params.operation === "copy") {
          await cp(sourcePath.absolutePath, targetPath.absolutePath, {
            recursive: sourceInfo.isDirectory(),
            force: params.collision === "replace",
            errorOnExist: params.collision !== "replace",
          });
        } else {
          await movePath(
            sourcePath.absolutePath,
            targetPath.absolutePath,
            sourceInfo.isDirectory(),
          );
          const wasStarred = await isPathStarredInDb(sourcePath.relativePath);
          if (wasStarred) {
            await setPathStarredInDb(sourcePath.relativePath, false);
            await setPathStarredInDb(targetPath.relativePath, true);
          }
        }

        return {
          root: targetPath.rootPath,
          path: targetPath.relativePath,
          type: sourceInfo.isDirectory() ? "folder" : "file",
        };
      } catch (error) {
        throw mapFsError(
          error,
          `Failed to ${params.operation === "copy" ? "copy" : "move"} item`,
          targetPath?.absolutePath ?? destinationDirectory?.absolutePath ?? sourcePath?.absolutePath,
        );
      }
    },
  );
}

export async function renameEntry(params: RenameEntryParams): Promise<FileRenameResponse> {
  return withServerTiming(
    {
      layer: "service",
      action: "files.renameEntry",
      meta: {
        path: params.path,
        newName: params.newName,
        includeHidden: Boolean(params.includeHidden),
      },
    },
    async () => {
      const includeHidden = Boolean(params.includeHidden);
      const newName = ensureSafeName(params.newName, includeHidden);
      let sourcePath: ResolvedFilesPath | undefined;
      let targetPath: ResolvedFilesPath | undefined;

      try {
        sourcePath = await resolveFilePath(params.path, includeHidden, {
          allowEmpty: false,
        });
        const sourceInfo = await lstat(sourcePath.absolutePath);
        if (sourceInfo.isSymbolicLink()) {
          throw new FileServiceError("Symlinks are not allowed", {
            code: "symlink_blocked",
            statusCode: 403,
          });
        }

        const parentRelativePath = sourcePath.segments.slice(0, -1).join("/");
        const nextRelativePath = joinRelativePath(
          parentRelativePath ? parentRelativePath.split("/") : [],
          newName,
        );
        targetPath = await resolveFilePath(nextRelativePath, includeHidden, {
          allowEmpty: false,
          allowMissingLeaf: true,
        });

        if (targetPath.absolutePath === sourcePath.absolutePath) {
          return {
            root: sourcePath.rootPath,
            oldPath: sourcePath.relativePath,
            path: sourcePath.relativePath,
            type: toEntryType(sourceInfo) ?? "file",
          };
        }

        if (targetPath.exists || (await pathExists(targetPath.absolutePath))) {
          throw new FileServiceError("Destination already exists", {
            code: "destination_exists",
            statusCode: 409,
          });
        }

        await rename(sourcePath.absolutePath, targetPath.absolutePath);
        const nextType = toEntryType(sourceInfo);
        if (!nextType) {
          throw new FileServiceError("Unsupported file type", {
            code: "unsupported_file",
            statusCode: 415,
          });
        }

        const wasStarred = await isPathStarredInDb(sourcePath.relativePath);
        if (wasStarred) {
          await setPathStarredInDb(sourcePath.relativePath, false);
          await setPathStarredInDb(targetPath.relativePath, true);
        }

        return {
          root: targetPath.rootPath,
          oldPath: sourcePath.relativePath,
          path: targetPath.relativePath,
          type: nextType,
        };
      } catch (error) {
        throw mapFsError(
          error,
          "Failed to rename item",
          targetPath?.absolutePath ?? sourcePath?.absolutePath,
        );
      }
    },
  );
}

export async function getEntryInfo(params: GetEntryInfoParams): Promise<FileInfoResponse> {
  return withServerTiming(
    {
      level: "debug",
      layer: "service",
      action: "files.getEntryInfo",
      meta: {
        path: params.path,
        includeHidden: Boolean(params.includeHidden),
      },
    },
    async () => {
      const includeHidden = Boolean(params.includeHidden);
      let resolved: ResolvedFilesPath | undefined;

      try {
        resolved = await resolveFilePath(params.path, includeHidden, {
          allowEmpty: false,
        });
        const linkInfo = await lstat(resolved.absolutePath);
        if (linkInfo.isSymbolicLink()) {
          throw new FileServiceError("Symlinks are not allowed", {
            code: "symlink_blocked",
            statusCode: 403,
          });
        }

        const entryType = toEntryType(linkInfo);
        if (!entryType) {
          throw new FileServiceError("Unsupported file type", {
            code: "unsupported_file",
            statusCode: 415,
          });
        }

        const entryName = path.basename(resolved.absolutePath);
        const entryExt = entryType === "file" ? getExtension(entryName) : null;
        const starred = await isPathStarredInDb(resolved.relativePath);

        return {
          root: resolved.rootPath,
          path: resolved.relativePath,
          absolutePath: resolved.absolutePath,
          name: entryName,
          type: entryType,
          ext: entryExt,
          sizeBytes: linkInfo.size,
          modifiedAt: linkInfo.mtime.toISOString(),
          createdAt: linkInfo.birthtime.toISOString(),
          permissions: toPermissionsString(linkInfo.mode),
          starred,
        };
      } catch (error) {
        throw mapFsError(error, "Failed to get file info", resolved?.absolutePath);
      }
    },
  );
}

export async function toggleStarEntry(
  params: ToggleStarEntryParams,
): Promise<FileToggleStarResponse> {
  return withServerTiming(
    {
      layer: "service",
      action: "files.toggleStar",
      meta: {
        path: params.path,
        includeHidden: Boolean(params.includeHidden),
      },
    },
    async () => {
      const includeHidden = Boolean(params.includeHidden);
      let resolved: ResolvedFilesPath | undefined;

      try {
        resolved = await resolveFilePath(params.path, includeHidden, {
          allowEmpty: false,
        });
        const linkInfo = await lstat(resolved.absolutePath);
        if (linkInfo.isSymbolicLink()) {
          throw new FileServiceError("Symlinks are not allowed", {
            code: "symlink_blocked",
            statusCode: 403,
          });
        }

        const entryType = toEntryType(linkInfo);
        if (!entryType) {
          throw new FileServiceError("Unsupported file type", {
            code: "unsupported_file",
            statusCode: 415,
          });
        }

        const currentlyStarred = await isPathStarredInDb(resolved.relativePath);
        const nextStarred = !currentlyStarred;
        await setPathStarredInDb(resolved.relativePath, nextStarred);

        return {
          path: resolved.relativePath,
          starred: nextStarred,
        };
      } catch (error) {
        throw mapFsError(error, "Failed to update star status", resolved?.absolutePath);
      }
    },
  );
}

export async function getStarredEntries(): Promise<FileListResponse> {
  const starredPaths = await listStarredPathsFromDb();
  const output: FileListEntry[] = [];

  await Promise.all(
    starredPaths.map(async (starredPath) => {
      try {
        const resolved = await resolveFilePath(starredPath, true, {
          allowEmpty: false,
        });
        const info = await lstat(resolved.absolutePath);
        if (info.isSymbolicLink()) return;
        const type = info.isDirectory() ? "folder" : info.isFile() ? "file" : null;
        if (!type) return;
        output.push({
          name: path.basename(resolved.relativePath),
          path: resolved.relativePath,
          type,
          ext: type === "file" ? getExtension(path.basename(resolved.relativePath)) : null,
          sizeBytes: type === "file" ? info.size : null,
          modifiedAt: info.mtime.toISOString(),
          mtimeMs: info.mtimeMs,
          starred: true,
        });
      } catch {
        // File no longer exists — silently skip stale star
      }
    }),
  );

  output.sort((a, b) => a.name.localeCompare(b.name));

  const rootResolved = await resolveFilePath("", true, { allowEmpty: true });

  return {
    root: rootResolved.rootPath,
    cwd: "Starred",
    entries: output,
  };
}

export type SearchFilesParams = {
  query: string;
  /** Relative path within FILES_ROOT to search under (default: root) */
  basePath?: string;
  includeHidden?: boolean;
  /** Maximum results to return (default: 200) */
  limit?: number;
  /**
   * Wall-clock budget for the recursive walk. Defaults to
   * FILES_SEARCH_TIMEOUT_MS so we never block the event loop on large
   * NAS mounts. When the deadline expires the response is returned
   * with `truncated: true` instead of throwing.
   */
  timeoutMs?: number;
};

export async function searchFiles(params: SearchFilesParams): Promise<FileListResponse> {
  return withServerTiming(
    {
      level: "debug",
      layer: "service",
      action: "files.search",
      meta: {
        basePath: params.basePath ?? "",
        includeHidden: Boolean(params.includeHidden),
        limit: params.limit ?? 200,
        queryLength: params.query.trim().length,
      },
      onSuccessMeta: (result) => ({
        entryCount: (result as FileListResponse).entries.length,
      }),
    },
    async () => {
      const includeHidden = Boolean(params.includeHidden);
      const query = params.query.trim().toLowerCase();
      const limit = params.limit ?? 200;
      const timeoutMs = params.timeoutMs ?? serverEnv.FILES_SEARCH_TIMEOUT_MS;
      const deadline = Date.now() + timeoutMs;

      if (query.length === 0) {
        throw new FileServiceError("Search query is empty", {
          code: "invalid_path",
          statusCode: 400,
        });
      }

      let baseResolved: ResolvedFilesPath;
      try {
        baseResolved = await resolveFilePath(params.basePath, includeHidden);
        const info = await lstat(baseResolved.absolutePath);
        if (!info.isDirectory()) {
          throw new FileServiceError("Path is not a directory", {
            code: "not_a_directory",
            statusCode: 400,
          });
        }
      } catch (error) {
        throw mapFsError(error, "Failed to resolve search base path");
      }

      const output: FileListEntry[] = [];
      let truncated = false;

      async function walk(absoluteDir: string, relativeDir: string) {
        if (output.length >= limit) return;
        if (Date.now() > deadline) {
          truncated = true;
          return;
        }

        let dirEntries: { name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }[];
        try {
          dirEntries = (await readdir(absoluteDir, { withFileTypes: true })).map((d) => ({
            name: d.name.toString(),
            isDirectory: () => d.isDirectory(),
            isFile: () => d.isFile(),
            isSymbolicLink: () => d.isSymbolicLink(),
          }));
        } catch {
          return;
        }

        for (const entry of dirEntries) {
          if (output.length >= limit) return;
          if (Date.now() > deadline) {
            truncated = true;
            return;
          }

          if (!includeHidden && isHiddenName(entry.name)) continue;
          if (relativeDir === "" && entry.name === "Trash") continue;

          const absoluteEntryPath = path.join(absoluteDir, entry.name);
          let info: Awaited<ReturnType<typeof lstat>>;
          try {
            info = await lstat(absoluteEntryPath);
          } catch {
            continue;
          }
          if (info.isSymbolicLink()) continue;

          const type = info.isDirectory() ? "folder" : info.isFile() ? "file" : null;
          if (!type) continue;

          const entryRelativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

          if (entry.name.toLowerCase().includes(query)) {
            output.push({
              name: entry.name,
              path: entryRelativePath,
              type,
              ext: type === "file" ? getExtension(entry.name) : null,
              sizeBytes: type === "file" ? info.size : null,
              modifiedAt: info.mtime.toISOString(),
              mtimeMs: info.mtimeMs,
            });
          }

          if (type === "folder") {
            // Yield to the event loop between subdirectory walks so the
            // system metrics SSE heartbeat (and other request handlers)
            // don't starve while we recurse a large tree on a Pi.
            await setImmediatePromise();
            await walk(absoluteEntryPath, entryRelativePath);
          }
        }
      }

      await walk(baseResolved.absolutePath, baseResolved.relativePath);
      output.sort((a, b) => a.name.localeCompare(b.name));

      const response: FileListResponse = {
        root: baseResolved.rootPath,
        cwd: baseResolved.relativePath,
        entries: output,
      };
      if (truncated) {
        response.truncated = true;
      }
      return response;
    },
  );
}

export type UploadFilesParams = {
  /** Relative path of the target directory within FILES_ROOT */
  destinationPath: string;
  files: { name: string; size: number; stream: () => ReadableStream }[];
  includeHidden?: boolean;
};

type UnzipEntryParams = {
  path: string;
  includeHidden?: boolean;
};

export async function unzipEntry(params: UnzipEntryParams): Promise<FileUnzipResponse> {
  return withServerTiming(
    { level: "debug", layer: "service", action: "files.unzipEntry" },
    async () => {
      const includeHidden = Boolean(params.includeHidden);
      let resolved: ResolvedFilesPath;

      try {
        resolved = await resolveFilePath(params.path, includeHidden);
        const info = await lstat(resolved.absolutePath);
        if (info.isSymbolicLink()) {
          throw new FileServiceError("Symlinks are not allowed", {
            code: "symlink_blocked",
            statusCode: 403,
          });
        }
        if (!info.isFile()) {
          throw new FileServiceError("Path is not a file", {
            code: "not_a_file",
            statusCode: 400,
          });
        }
      } catch (error) {
        if (error instanceof FileServiceError) throw error;
        throw mapFsError(error, "Failed to access zip file");
      }

      const fileName = resolved.segments[resolved.segments.length - 1] ?? "";
      if (getExtension(fileName) !== "zip") {
        throw new FileServiceError("File is not a zip archive", {
          code: "unsupported_file",
          statusCode: 400,
        });
      }

      const parentAbsolutePath = path.dirname(resolved.absolutePath);
      const destinationPath =
        resolved.segments.length > 1 ? resolved.segments.slice(0, -1).join("/") : "";

      const execFileAsync = promisify(execFile);

      // Pre-inspection: Ensure archive contains no symlinks, absolute paths, or Zip Slip path traversals
      try {
        const { stdout: zipList } = await execFileAsync("unzip", ["-Z", "-1", resolved.absolutePath]);
        const entries = zipList.split("\n");
        for (const entry of entries) {
          const trimmed = entry.trim();
          if (!trimmed) continue;
          if (
            trimmed.startsWith("/") ||
            trimmed.startsWith("\\") ||
            trimmed.includes("\0") ||
            /^[a-zA-Z]:/.test(trimmed)
          ) {
            throw new FileServiceError("Zip archive contains invalid paths", {
              code: "invalid_path",
              statusCode: 400,
            });
          }
          const segments = trimmed.split(/[/\\]/);
          if (segments.includes("..")) {
            throw new FileServiceError("Zip archive contains path traversal entries", {
              code: "invalid_path",
              statusCode: 400,
            });
          }
          const candidatePath = path.resolve(parentAbsolutePath, trimmed);
          const relative = path.relative(parentAbsolutePath, candidatePath);
          if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
            throw new FileServiceError("Zip archive entries escape destination directory", {
              code: "path_outside_root",
              statusCode: 400,
            });
          }
        }

        // Check for symbolic links in zip details
        const { stdout: zipDetails } = await execFileAsync("unzip", ["-Z", resolved.absolutePath]);
        for (const line of zipDetails.split("\n")) {
          const lineTrimmed = line.trim();
          if (!lineTrimmed) continue;
          if (lineTrimmed.startsWith("l")) {
            throw new FileServiceError("Zip archive contains symbolic links", {
              code: "symlink_blocked",
              statusCode: 403,
            });
          }
        }
      } catch (err) {
        if (err instanceof FileServiceError) throw err;
        throw new FileServiceError("Failed to inspect zip archive", {
          code: "internal_error",
          statusCode: 500,
          cause: err,
        });
      }

      await new Promise<void>((resolve, reject) => {
        const proc = spawn("unzip", ["-o", resolved.absolutePath, "-d", parentAbsolutePath]);
        proc.on("close", (code) => {
          // unzip exit code 1 = warnings only (acceptable)
          if (code === 0 || code === 1) resolve();
          else reject(new FileServiceError(`unzip exited with code ${String(code)}`, { code: "internal_error", statusCode: 500 }));
        });
        proc.on("error", (err) => {
          reject(new FileServiceError("Failed to run unzip", { code: "internal_error", statusCode: 500, cause: err }));
        });
      });

      return { destinationPath };
    },
  );
}

export async function uploadFiles(params: UploadFilesParams): Promise<FileUploadResponse> {
  const includeHidden = Boolean(params.includeHidden);
  const destination = await assertDirectoryPath(params.destinationPath, includeHidden, {
    allowEmpty: true,
  });

  const uploaded: FileUploadResponse["uploaded"] = [];
  const skipped: string[] = [];

  await Promise.all(
    params.files.map(async ({ name, size, stream }) => {
      let safeName: string;
      try {
        safeName = ensureSafeName(name, includeHidden);
      } catch {
        skipped.push(name);
        return;
      }

      const relativePath = joinRelativePath(destination.segments, safeName);
      let targetPath: ResolvedFilesPath;
      try {
        targetPath = await resolveFilePath(relativePath, includeHidden, {
          allowEmpty: false,
          allowMissingLeaf: true,
        });
      } catch {
        skipped.push(name);
        return;
      }

      if (targetPath.exists || (await pathExists(targetPath.absolutePath))) {
        skipped.push(name);
        return;
      }

      await pipeline(
        Readable.fromWeb(stream() as import("stream/web").ReadableStream),
        createWriteStream(targetPath.absolutePath),
      );
      uploaded.push({
        name: safeName,
        path: targetPath.relativePath,
        sizeBytes: size,
      });
    }),
  );

  return { uploaded, skipped };
}
