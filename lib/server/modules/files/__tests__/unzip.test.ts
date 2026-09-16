import { describe, expect, it, vi, beforeEach } from "vitest";

const { execFileMock, lstatMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  lstatMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawn: vi.fn(() => ({
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === "close") cb(0);
    }),
  })),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: lstatMock,
  };
});

vi.mock("@/lib/server/modules/files/path-resolver", () => ({
  FilesPathError: class FilesPathError extends Error {},
  resolvePathWithinFilesRoot: vi.fn(async ({ inputPath }: { inputPath: string }) => ({
    rootPath: "/data",
    relativePath: inputPath,
    absolutePath: `/data/${inputPath}`,
    segments: inputPath.split("/"),
  })),
  resolveFilePath: vi.fn(async (p: string) => ({
    rootPath: "/data",
    relativePath: p,
    absolutePath: `/data/${p}`,
    segments: p.split("/"),
  })),
}));

import { unzipEntry } from "@/lib/server/modules/files/service";

type ExecCallback = (err: Error | null, res?: { stdout: string; stderr: string }) => void;

/**
 * The callback is whatever the last argument is. `execFile` is called with or
 * without an options object depending on the caller, and a mock that assumes
 * a fixed arity silently never resolves — which shows up as a five-second
 * timeout rather than as a failed assertion.
 */
function resolveExecFile(stdout: string) {
  return (...args: unknown[]) => {
    const cb = args.at(-1) as ExecCallback;
    cb(null, { stdout, stderr: "" });
  };
}

describe("unzipEntry security validation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    execFileMock.mockReset();
    lstatMock.mockReset();
    lstatMock.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
    });
  });

  it("rejects zip archives containing path traversal segments (..)", async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const args = callArgs[1] as string[];
      const cb = callArgs.at(-1) as (e: null, r: { stdout: string; stderr: string }) => void;
      // The listing call is `unzip -Z1 <zip>`; extraction is not.
      if (args.some((arg) => arg.startsWith("-Z"))) {
        cb(null, { stdout: "sub/file.txt\n../../etc/shadow\n", stderr: "" });
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
      });

    await expect(unzipEntry({ path: "test.zip" })).rejects.toMatchObject({
      message: "Zip archive contains path traversal entries",
    });
  });

  it("rejects zip archives containing absolute paths", async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const args = callArgs[1] as string[];
      const cb = callArgs.at(-1) as (e: null, r: { stdout: string; stderr: string }) => void;
      // The listing call is `unzip -Z1 <zip>`; extraction is not.
      if (args.some((arg) => arg.startsWith("-Z"))) {
        cb(null, { stdout: "/etc/passwd\n", stderr: "" });
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
      });

    await expect(unzipEntry({ path: "test.zip" })).rejects.toMatchObject({
      message: "Zip archive contains invalid paths",
    });
  });

  it("rejects zip archives containing symbolic links", async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const args = callArgs[1] as string[];
      const cb = callArgs.at(-1) as (e: null, r: { stdout: string; stderr: string }) => void;

      // `-Z1` lists names, plain `-Z` is the verbose listing the symlink check
      // reads. Both start with -Z, so the exact flag is what tells them apart.
      if (args.includes("-Z1")) {
        cb(null, { stdout: "malicious_link\n", stderr: "" });
      } else {
        // unzip -Z output with symlink flag 'lrwxrwxrwx'
        cb(null, { stdout: "lrwxrwxrwx 1 user group 11 Jan 1 00:00 malicious_link -> /etc/passwd\n", stderr: "" });
      }
    });

    await expect(unzipEntry({ path: "test.zip" })).rejects.toMatchObject({
      message: "Zip archive contains symbolic links",
    });
  });
});
