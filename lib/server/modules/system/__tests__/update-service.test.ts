import type * as NodeFsPromises from "node:fs/promises";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { execFileMock, statMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof NodeFsPromises>();
  return { ...original, stat: statMock };
});

import {
  buildRemotePackageJsonApiUrl,
  buildRemotePackageJsonUrl,
  compareVersions,
  getSystemUpdateStatus,
  scheduleSystemUpdate,
} from "@/lib/server/modules/system/update-service";
import packageJson from "@/package.json";

function resolveExecFileCallback(args: unknown[]) {
  const maybeCallback = args.at(-1);
  if (typeof maybeCallback !== "function") {
    throw new Error("Expected execFile callback");
  }

  return maybeCallback as (error: Error | null, stdout?: string, stderr?: string) => void;
}

function bumpPatchVersion(version: string) {
  const parts = version.split(".");
  const last = Number.parseInt(parts.at(-1) ?? "0", 10);
  parts[parts.length - 1] = String(Number.isFinite(last) ? last + 1 : 1);
  return parts.join(".");
}

describe("update-service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    execFileMock.mockReset();
  });

  it("compares semantic versions correctly", () => {
    expect(compareVersions("0.1.75", "0.1.74")).toBe(1);
    expect(compareVersions("0.1.74", "0.1.74")).toBe(0);
    expect(compareVersions("0.1.73", "0.1.74")).toBe(-1);
  });

  it("builds a raw GitHub package.json url from the repo config", () => {
    expect(
      buildRemotePackageJsonUrl("https://github.com/doctor-io/homeio.git", "main"),
    ).toBe("https://raw.githubusercontent.com/doctor-io/homeio/main/package.json");
  });

  it("builds a GitHub contents API url from the repo config", () => {
    expect(
      buildRemotePackageJsonApiUrl("https://github.com/doctor-io/homeio.git", "main"),
    ).toBe("https://api.github.com/repos/doctor-io/homeio/contents/package.json?ref=main");
  });

  it("reads the current version and reports update availability", async () => {
    const nextVersion = bumpPatchVersion(packageJson.version);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: Buffer.from(JSON.stringify({ version: nextVersion }), "utf8").toString("base64"),
        encoding: "base64",
      }),
    } as Response);

    const status = await getSystemUpdateStatus();

    expect(status.currentVersion).toBe(packageJson.version);
    expect(status.latestVersion).toBe(nextVersion);
    expect(status.updateAvailable).toBe(true);
    expect(status.checkedAt).toBeTruthy();
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe(
      "https://api.github.com/repos/doctor-io/homeio/contents/package.json?ref=main",
    );
    expect(requestInit).toMatchObject({
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "homeio-update-check",
      },
    });
  });

  it("schedules the updater through a transient systemd unit", async () => {
    statMock.mockResolvedValueOnce({});
    execFileMock.mockImplementation((command: string, args: string[], ...rest: unknown[]) => {
      const callback = resolveExecFileCallback(rest);
      callback(null, "", "");
    });

    const result = await scheduleSystemUpdate();

    expect(result).toEqual({
      action: "update",
      accepted: true,
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "systemd-run",
      expect.arrayContaining([
        "--quiet",
        "--no-block",
        "--collect",
        "--property=Type=exec",
        "--property=KillMode=control-group",
        "--property=TimeoutStopSec=30s",
        "--property=SendSIGKILL=yes",
        "bash",
        "-lc",
        expect.stringContaining("scripts/update.sh"),
      ]),
      expect.any(Function),
    );
  });

  it("rejects scheduling when the update script does not exist", async () => {
    statMock.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    await expect(scheduleSystemUpdate()).rejects.toThrow(
      "Update script not found",
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

    it("rejects scheduling when running inside a container runtime", async () => {
    process.env.HOMEIO_CONTAINER = "true";
    try {
      await expect(scheduleSystemUpdate()).rejects.toThrow(
        "Homeio is running in a Docker container",
      );
    } finally {
      delete process.env.HOMEIO_CONTAINER;
    }
  });
});
