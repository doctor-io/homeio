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

function resolveExecFile(stdout: string) {
  return (_cmd: string, _args: string[], cb: (err: Error | null, res?: { stdout: string; stderr: string }) => void) => {
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
    execFileMock.mockImplementation((_cmd, args, cb) => {
      if (args.includes("-1")) {
        cb(null, { stdout: "sub/file.txt\n../../etc/shadow\n", stderr: "" });
      }
    });

    await expect(unzipEntry({ path: "test.zip" })).rejects.toMatchObject({
      message: "Zip archive contains path traversal entries",
    });
  });

  it("rejects zip archives containing absolute paths", async () => {
    execFileMock.mockImplementation((_cmd, args, cb) => {
      if (args.includes("-1")) {
        cb(null, { stdout: "/etc/passwd\n", stderr: "" });
      }
    });

    await expect(unzipEntry({ path: "test.zip" })).rejects.toMatchObject({
      message: "Zip archive contains invalid paths",
    });
  });

  it("rejects zip archives containing symbolic links", async () => {
    execFileMock.mockImplementation((_cmd, args, cb) => {
      if (args.includes("-1")) {
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
