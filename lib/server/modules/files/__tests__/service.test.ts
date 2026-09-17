import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockDataRoot = "";

vi.mock("@/lib/server/modules/files/stars-repository", () => ({
  isPathStarredInDb: vi.fn(async () => false),
  listStarredPathsFromDb: vi.fn(async () => []),
  setPathStarredInDb: vi.fn(async () => undefined),
}));

vi.mock("@/lib/server/modules/files/trash-repository", () => ({
  listTrashEntriesFromDb: vi.fn(async () => []),
}));

vi.mock("@/lib/server/modules/files/path-resolver", () => {
  class FilesPathError extends Error {
    code: string;
    statusCode: number;

    constructor(
      message: string,
      options?: {
        code?: string;
        statusCode?: number;
      },
    ) {
      super(message);
      this.code = options?.code ?? "internal_error";
      this.statusCode = options?.statusCode ?? 500;
    }
  }

  function ensureWithinRoot(rootPath: string, absolutePath: string) {
    const relative = path.relative(rootPath, absolutePath);
    const within =
      relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    if (!within) {
      throw new FilesPathError("Path escapes root", {
        code: "path_outside_root",
        statusCode: 400,
      });
    }
  }

  return {
    FilesPathError,
    resolvePathWithinFilesRoot: vi.fn(async (input: {
      inputPath?: string;
      allowEmpty?: boolean;
      allowHiddenSegments?: boolean;
      allowMissingLeaf?: boolean;
      requiredPrefix?: string;
    }) => {
      const cleaned = (input.inputPath ?? "").trim().replaceAll("\\", "/");
      if (!cleaned) {
        if (!input.allowEmpty) {
          throw new FilesPathError("Invalid path", {
            code: "invalid_path",
            statusCode: 400,
          });
        }
      }

      const normalized = cleaned ? path.posix.normalize(cleaned) : "";
      if (cleaned.startsWith("/") || cleaned.includes("\0")) {
        throw new FilesPathError("Invalid path", {
          code: "invalid_path",
          statusCode: 400,
        });
      }
      if (normalized === ".." || normalized.startsWith("../")) {
        throw new FilesPathError("Path escapes root", {
          code: "path_outside_root",
          statusCode: 400,
        });
      }

      const relativePath = normalized === "." ? "" : normalized;
      const segments = relativePath ? relativePath.split("/") : [];
      if (
        input.requiredPrefix &&
        relativePath !== input.requiredPrefix &&
        !relativePath.startsWith(`${input.requiredPrefix}/`)
      ) {
        throw new FilesPathError("Invalid path", {
          code: "invalid_path",
          statusCode: 400,
        });
      }
      if (!input.allowHiddenSegments && segments.some((segment) => segment.startsWith("."))) {
        throw new FilesPathError("Hidden files are not allowed", {
          code: "hidden_blocked",
          statusCode: 403,
        });
      }

      let current = mockDataRoot;
      for (const segment of segments) {
        current = path.join(current, segment);
        try {
          const info = await lstat(current);
          if (info.isSymbolicLink()) {
            throw new FilesPathError("Symlinks are not allowed", {
              code: "symlink_blocked",
              statusCode: 403,
            });
          }
        } catch (error) {
          const nodeError = error as NodeJS.ErrnoException;
          if (nodeError?.code === "ENOENT") {
            if (input.allowMissingLeaf) break;
            throw new FilesPathError("File or directory not found", {
              code: "not_found",
              statusCode: 404,
            });
          }
          throw error;
        }
      }

      const absolutePath = path.resolve(mockDataRoot, relativePath);
      ensureWithinRoot(mockDataRoot, absolutePath);
      try {
        await lstat(absolutePath);
        return {
          rootPath: mockDataRoot,
          relativePath,
          absolutePath,
          segments,
          exists: true,
        };
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError?.code !== "ENOENT") throw error;
      }

      if (!input.allowMissingLeaf) {
        throw new FilesPathError("File or directory not found", {
          code: "not_found",
          statusCode: 404,
        });
      }

      return {
        rootPath: mockDataRoot,
        relativePath,
        absolutePath,
        segments,
        exists: false,
      };
    }),
  };
});

import {
  createDirectoryEntry,
  createFileEntry,
  FileServiceError,
  MAX_TEXT_READ_BYTES,
  listDirectory,
  pasteEntry,
  readFileForViewer,
  searchFiles,
  uploadFiles,
  writeTextFile,
} from "@/lib/server/modules/files/service";

describe("files service", () => {
  beforeEach(async () => {
    mockDataRoot = await mkdtemp(path.join(os.tmpdir(), "home-server-files-"));
  });

  afterEach(async () => {
    if (mockDataRoot) {
      await rm(mockDataRoot, { recursive: true, force: true });
    }
  });

  it("lists folders first and hides hidden and symlink entries by default", async () => {
    await mkdir(path.join(mockDataRoot, "ZetaFolder"), { recursive: true });
    await writeFile(path.join(mockDataRoot, "alpha.txt"), "alpha", "utf8");
    await writeFile(path.join(mockDataRoot, ".hidden.txt"), "hidden", "utf8");
    await symlink(path.join(mockDataRoot, "alpha.txt"), path.join(mockDataRoot, "alpha-link"));

    const result = await listDirectory({
      path: "",
    });

    expect(result.root).toBe(mockDataRoot);
    expect(result.cwd).toBe("");
    expect(result.entries.map((entry) => entry.name)).toEqual([
      "ZetaFolder",
      "alpha.txt",
    ]);
    expect(result.entries[0]?.type).toBe("folder");
    expect(result.entries[1]?.type).toBe("file");
  });

  it("blocks traversal paths outside root", async () => {
    await expect(
      listDirectory({
        path: "../etc",
      }),
    ).rejects.toMatchObject({
      code: "path_outside_root",
    });
  });

  it("blocks symlink traversal", async () => {
    await mkdir(path.join(mockDataRoot, "safe"), { recursive: true });
    await symlink(path.join(mockDataRoot, "safe"), path.join(mockDataRoot, "safe-link"));

    await expect(
      listDirectory({
        path: "safe-link",
      }),
    ).rejects.toMatchObject({
      code: "symlink_blocked",
    });
  });

  it("classifies read mode for text, image, and pdf files", async () => {
    await writeFile(path.join(mockDataRoot, "config.yaml"), "name: home", "utf8");
    await writeFile(path.join(mockDataRoot, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(path.join(mockDataRoot, "manual.pdf"), Buffer.from("%PDF-1.7", "utf8"));

    const textResult = await readFileForViewer({
      path: "config.yaml",
    });
    const imageResult = await readFileForViewer({
      path: "photo.png",
    });
    const pdfResult = await readFileForViewer({
      path: "manual.pdf",
    });

    expect(textResult.mode).toBe("text");
    expect(textResult.content).toBe("name: home");
    expect(imageResult.mode).toBe("image");
    expect(imageResult.content).toBeNull();
    expect(pdfResult.mode).toBe("pdf");
    expect(pdfResult.content).toBeNull();
  });

  it("returns too_large mode for oversized text files", async () => {
    const largeText = "a".repeat(MAX_TEXT_READ_BYTES + 1);
    await writeFile(path.join(mockDataRoot, "large.txt"), largeText, "utf8");

    const result = await readFileForViewer({
      path: "large.txt",
    });

    expect(result.mode).toBe("too_large");
    expect(result.content).toBeNull();
    expect(result.sizeBytes).toBe(MAX_TEXT_READ_BYTES + 1);
  });

  it("writes text files and enforces optimistic mtime conflict", async () => {
    const filePath = path.join(mockDataRoot, "notes.txt");
    await writeFile(filePath, "before", "utf8");

    const opened = await readFileForViewer({
      path: "notes.txt",
    });

    const saved = await writeTextFile({
      path: "notes.txt",
      content: "after",
      expectedMtimeMs: opened.mtimeMs,
    });

    expect(saved.path).toBe("notes.txt");
    expect(await readFile(filePath, "utf8")).toBe("after");

    await writeFile(filePath, "changed-outside", "utf8");

    await expect(
      writeTextFile({
        path: "notes.txt",
        content: "conflict-write",
        expectedMtimeMs: opened.mtimeMs,
      }),
    ).rejects.toMatchObject({
      code: "write_conflict",
    });
  });

  it("shows hidden entries when listing Trash", async () => {
    await mkdir(path.join(mockDataRoot, "Trash"), { recursive: true });
    await writeFile(path.join(mockDataRoot, "Trash", ".env"), "x=1", "utf8");
    await writeFile(path.join(mockDataRoot, "Trash", "notes.txt"), "hello", "utf8");

    const result = await listDirectory({
      path: "Trash",
    });

    expect(result.entries.map((entry) => entry.name)).toEqual([
      ".env",
      "notes.txt",
    ]);
  });

  it("shows hidden entries when includeHidden is true", async () => {
    await writeFile(path.join(mockDataRoot, ".env"), "x=1", "utf8");
    await writeFile(path.join(mockDataRoot, "notes.txt"), "hello", "utf8");

    const result = await listDirectory({
      path: "",
      includeHidden: true,
    });

    expect(result.entries.map((entry) => entry.name)).toEqual([
      ".env",
      "notes.txt",
    ]);
  });

  it("creates folder and file entries in the requested directory", async () => {
    await mkdir(path.join(mockDataRoot, "Documents"), { recursive: true });

    const createdFolder = await createDirectoryEntry({
      parentPath: "Documents",
      name: "Projects",
    });
    const createdFile = await createFileEntry({
      parentPath: "Documents",
      name: "todo.txt",
    });

    expect(createdFolder.path).toBe("Documents/Projects");
    expect(createdFolder.type).toBe("folder");
    expect(createdFile.path).toBe("Documents/todo.txt");
    expect(createdFile.type).toBe("file");
  });

  it("copies entries into destination directory", async () => {
    await mkdir(path.join(mockDataRoot, "Documents"), { recursive: true });
    await mkdir(path.join(mockDataRoot, "Media"), { recursive: true });
    await writeFile(path.join(mockDataRoot, "Media", "photo.jpg"), "binary", "utf8");

    const copied = await pasteEntry({
      sourcePath: "Media/photo.jpg",
      destinationPath: "Documents",
      operation: "copy",
    });

    expect(copied.path).toBe("Documents/photo.jpg");
    expect(await readFile(path.join(mockDataRoot, "Media", "photo.jpg"), "utf8")).toBe("binary");
    expect(await readFile(path.join(mockDataRoot, "Documents", "photo.jpg"), "utf8")).toBe("binary");
  });

  it("moves entries into destination directory", async () => {
    await mkdir(path.join(mockDataRoot, "Documents"), { recursive: true });
    await mkdir(path.join(mockDataRoot, "Media"), { recursive: true });
    await writeFile(path.join(mockDataRoot, "Media", "move-me.txt"), "m", "utf8");

    const moved = await pasteEntry({
      sourcePath: "Media/move-me.txt",
      destinationPath: "Documents",
      operation: "move",
    });

    expect(moved.path).toBe("Documents/move-me.txt");
    await expect(
      readFile(path.join(mockDataRoot, "Media", "move-me.txt"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(path.join(mockDataRoot, "Documents", "move-me.txt"), "utf8")).toBe("m");
  });

  it("rejects paste when destination exists", async () => {
    await mkdir(path.join(mockDataRoot, "Documents"), { recursive: true });
    await mkdir(path.join(mockDataRoot, "Media"), { recursive: true });
    await writeFile(path.join(mockDataRoot, "Media", "photo.jpg"), "src", "utf8");
    await writeFile(path.join(mockDataRoot, "Documents", "photo.jpg"), "dst", "utf8");

    await expect(
      pasteEntry({
        sourcePath: "Media/photo.jpg",
        destinationPath: "Documents",
        operation: "copy",
      }),
    ).rejects.toMatchObject({
      code: "destination_exists",
    });
  });

  describe("searchFiles", () => {
    it("returns matching entries by name", async () => {
      await mkdir(path.join(mockDataRoot, "Documents"), { recursive: true });
      await writeFile(path.join(mockDataRoot, "Documents", "notes.md"), "x");
      await writeFile(path.join(mockDataRoot, "Documents", "ignore.txt"), "x");

      const result = await searchFiles({ query: "notes" });

      expect(result.entries.map((e) => e.name)).toEqual(["notes.md"]);
      expect(result.truncated).toBeUndefined();
    });

    it("flags truncated when the deadline expires before walk completes", async () => {
      await mkdir(path.join(mockDataRoot, "Deep"), { recursive: true });
      // A few nested directories with files; the per-subdir setImmediate
      // yield means a 0-ms deadline trips before we finish the walk.
      for (let i = 0; i < 5; i += 1) {
        const dir = path.join(mockDataRoot, "Deep", `level-${i}`);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "match-target.txt"), "x");
      }

      const result = await searchFiles({
        query: "match-target",
        timeoutMs: 1_000,
      });
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.truncated).toBeUndefined();

      const truncatedResult = await searchFiles({
        query: "match-target",
        timeoutMs: -1_000, // deadline already in the past — trips on first walk
      });
      expect(truncatedResult.truncated).toBe(true);
    });
  });
});

describe("uploading to a destination that is refused (D-15)", () => {
  beforeEach(async () => {
    mockDataRoot = await mkdtemp(path.join(os.tmpdir(), "home-server-upload-"));
  });

  afterEach(async () => {
    if (mockDataRoot) await rm(mockDataRoot, { recursive: true, force: true });
  });

  it("says what was wrong with the path, not that the server failed", async () => {
    // The resolver throws FilesPathError; uploadFiles did not put it through
    // mapFsError, so the route — which only knows FileServiceError — answered
    // "Failed to upload files" with a 500. Measured against a running server:
    // a traversal, a symlink and an absolute path all came back as 500s, while
    // the same three on the listing route say path_outside_root, symlink_blocked
    // and invalid_path.
    // toMatchObject alone is not enough here: FilesPathError carries `code` and
    // `statusCode` too, so the fields match with or without the conversion. The
    // type is what the route dispatches on, so the type is what is asserted.
    const error = await uploadFiles({ destinationPath: "../../..", files: [] }).catch(
      (thrown) => thrown,
    );

    expect(error).toBeInstanceOf(FileServiceError);
    expect(error).toMatchObject({ code: "path_outside_root", statusCode: 400 });
  });

  it("carries the error as the type every route in this module catches", async () => {
    await expect(
      uploadFiles({ destinationPath: "../../..", files: [] }),
    ).rejects.toBeInstanceOf(FileServiceError);
  });
});
