import type * as NodeFsPromises from "node:fs/promises";
import path from "node:path";
import { inc } from "semver";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

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

vi.mock("@/lib/server/modules/system/update-channel-repository", () => ({
  readUpdateChannel: vi.fn(),
  withLockedUpdateChannel: vi.fn(),
  writeUpdateChannel: vi.fn(),
}));

import { readUpdateChannel, withLockedUpdateChannel, writeUpdateChannel } from "@/lib/server/modules/system/update-channel-repository";
import {
  buildLatestReleaseApiUrl,
  buildRemotePackageJsonApiUrl,
  buildRemotePackageJsonUrl,
  compareVersions,
  getSystemUpdateChannel,
  getSystemUpdateStatus,
  resetUpdateStatusCacheForTests,
  scheduleSystemUpdate,
  setSystemUpdateChannel,
} from "@/lib/server/modules/system/update-service";
import packageJson from "@/package.json";

function resolveExecFileCallback(args: unknown[]) {
  const maybeCallback = args.at(-1);
  if (typeof maybeCallback !== "function") {
    throw new Error("Expected execFile callback");
  }

  return maybeCallback as (error: Error | null, stdout?: string, stderr?: string) => void;
}

function releaseResponse(tag: string) {
  return { ok: true, status: 200, json: async () => ({ tag_name: tag }) } as Response;
}

function branchResponse(version: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: Buffer.from(JSON.stringify({ version }), "utf8").toString("base64"),
      encoding: "base64",
    }),
  } as Response;
}

function succeedAllExecFileCalls() {
  execFileMock.mockImplementation((_command: string, _args: string[], ...rest: unknown[]) => {
    resolveExecFileCallback(rest)(null, "", "");
  });
}

describe("update-service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetUpdateStatusCacheForTests();
    execFileMock.mockReset();
    statMock.mockReset();
    vi.mocked(readUpdateChannel).mockReset().mockResolvedValue("stable");
    vi.mocked(withLockedUpdateChannel).mockReset().mockImplementation((action) => action("stable"));
    // Release mode unless a test opts into following a branch.
    vi.stubEnv("HOMEIO_REPO_BRANCH", "");
    vi.stubEnv("HOMEIO_CONTAINER", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("compares semantic versions correctly", () => {
    expect(compareVersions("0.1.75", "0.1.74")).toBe(1);
    expect(compareVersions("0.1.74", "0.1.74")).toBe(0);
    expect(compareVersions("0.1.73", "0.1.74")).toBe(-1);
    expect(compareVersions("v1.2.0-beta.10", "1.2.0-beta.2")).toBe(1);
    expect(compareVersions("1.2.0-rc.1", "1.2.0")).toBe(-1);
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

  it("reports that the Docker image cannot update itself", async () => {
    vi.stubEnv("HOMEIO_CONTAINER", "true");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(releaseResponse("v1.0.0"));

    const status = await getSystemUpdateStatus();
    expect(status.canSelfUpdate).toBe(false);
  });

  it("offers the latest published release, not whatever main holds", async () => {
    const nextVersion = inc(packageJson.version, "patch");
    if (!nextVersion) throw new Error("The package version must use SemVer.");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(releaseResponse(`v${nextVersion}`));

    const status = await getSystemUpdateStatus();

    expect(status.currentVersion).toBe(packageJson.version);
    expect(status.latestVersion).toBe(nextVersion);
    expect(status.updateAvailable).toBe(true);
    expect(status.checkedAt).toBeTruthy();
    expect(status.canSelfUpdate).toBe(true);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe(buildLatestReleaseApiUrl());
    expect(String(requestUrl)).toBe("https://api.github.com/repos/doctor-io/homeio/releases/latest");
    expect(requestInit).toMatchObject({
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "homeio-update-check",
      },
    });
  });

  it("reports no update before the first release is published", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    const status = await getSystemUpdateStatus();

    expect(status.latestVersion).toBeNull();
    expect(status.updateAvailable).toBe(false);
  });

  it("uses the highest published version on Beta without sharing Stable's cache", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(releaseResponse("v1.11.2"))
      .mockResolvedValueOnce(Response.json([
        { tag_name: "v2.0.0-beta.2", prerelease: true, draft: false },
        { tag_name: "v3.0.0-beta.1", prerelease: true, draft: true },
        { tag_name: "main", prerelease: true, draft: false },
        { tag_name: "v4.0.0-beta.1", prerelease: false, draft: false },
      ], { headers: { link: '<https://api.github.com/repos/doctor-io/homeio/releases?page=2>; rel="next"' } }))
      .mockResolvedValueOnce(Response.json([
        { tag_name: "v2.0.0-beta.10", prerelease: true, draft: false },
        { tag_name: "v1.12.0", prerelease: false, draft: false },
      ]));

    expect((await getSystemUpdateStatus()).latestVersion).toBe("1.11.2");
    vi.mocked(readUpdateChannel).mockResolvedValueOnce("beta");
    expect(await getSystemUpdateStatus()).toMatchObject({
      latestVersion: "2.0.0-beta.10",
      updateAvailable: true,
    });
    expect((await getSystemUpdateStatus()).latestVersion).toBe("1.11.2");
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/repos/doctor-io/homeio/releases?per_page=100&page=2",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("saves the release channel and preserves an explicit branch override", async () => {
    expect(await setSystemUpdateChannel("beta")).toEqual({ channel: "beta", disabledReason: null });
    expect(writeUpdateChannel).toHaveBeenCalledWith("beta");
    vi.stubEnv("HOMEIO_REPO_BRANCH", "develop");
    expect((await getSystemUpdateChannel()).disabledReason).toContain("HOMEIO_REPO_BRANCH");
    await expect(setSystemUpdateChannel("stable")).rejects.toThrow("HOMEIO_REPO_BRANCH");
    expect(writeUpdateChannel).toHaveBeenCalledTimes(1);
  });

  it("rejects a latest release whose tag is not a version", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(releaseResponse("main; rm -rf /"));

    await expect(getSystemUpdateStatus()).rejects.toThrow("does not have a version tag");
  });

  it("follows HOMEIO_REPO_BRANCH when a server sets it", async () => {
    vi.stubEnv("HOMEIO_REPO_BRANCH", "v2.0");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(branchResponse("2.0.13"));

    const status = await getSystemUpdateStatus();

    expect(status.latestVersion).toBe("2.0.13");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/doctor-io/homeio/contents/package.json?ref=v2.0",
    );
  });

  it("asks GitHub at most once an hour, however many desktops load", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(releaseResponse("v9.9.9"));

    await Promise.all([getSystemUpdateStatus(), getSystemUpdateStatus(), getSystemUpdateStatus()]);
    now.mockReturnValue(1_000_000 + 59 * 60_000);
    await getSystemUpdateStatus();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + 60 * 60_000);
    await getSystemUpdateStatus();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves the last known version when GitHub rate-limits the check", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(releaseResponse("v9.9.9"))
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    const first = await getSystemUpdateStatus();

    now.mockReturnValue(1_000_000 + 2 * 60 * 60_000);
    const second = await getSystemUpdateStatus();

    expect(second.latestVersion).toBe("9.9.9");
    // The answer is as old as the last successful check, and says so.
    expect(second.checkedAt).toBe(first.checkedAt);
  });

  it("asks GitHub and reports its failure when the user checks now", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(releaseResponse("v9.9.9"))
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    await getSystemUpdateStatus();

    await expect(getSystemUpdateStatus({ refresh: true })).rejects.toThrow("(403)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still fails when GitHub cannot be reached and nothing is known yet", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    await expect(getSystemUpdateStatus()).rejects.toThrow("(403)");
  });

  it("waits five minutes before asking a rate-limiting GitHub again", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 429 } as Response)
      .mockResolvedValueOnce(releaseResponse("v9.9.9"));

    await expect(getSystemUpdateStatus()).rejects.toThrow("(429)");
    now.mockReturnValue(1_000_000 + 4 * 60_000);
    await expect(getSystemUpdateStatus()).rejects.toThrow("(429)");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + 5 * 60_000);
    expect((await getSystemUpdateStatus()).latestVersion).toBe("9.9.9");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("schedules the updater through a transient systemd unit, pinned to the latest release", async () => {
    statMock.mockResolvedValueOnce({});
    succeedAllExecFileCalls();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(releaseResponse("v9.9.9"));

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
        "--setenv=HOMEIO_REPO_BRANCH=v9.9.9",
        "--setenv=HOMEIO_REPO_URL=https://github.com/doctor-io/homeio.git",
        "bash",
        "-lc",
        expect.stringContaining(path.join("scripts", "update.sh")),
      ]),
      expect.any(Function),
    );
  });

  it("installs the advertised Beta tag and rejects a stale selection or older version", async () => {
    statMock.mockResolvedValue({});
    succeedAllExecFileCalls();
    vi.mocked(readUpdateChannel).mockResolvedValueOnce("beta");
    vi.mocked(withLockedUpdateChannel).mockImplementationOnce((action) => action("beta"));
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json([
        { tag_name: "v2.0.0-beta.10", prerelease: true, draft: false },
      ]))
      .mockResolvedValueOnce(releaseResponse("v1.12.0"))
      .mockResolvedValueOnce(releaseResponse("v1.0.0"));

    await scheduleSystemUpdate("2.0.0-beta.10");
    expect(execFileMock).toHaveBeenCalledWith(
      "systemd-run",
      expect.arrayContaining(["--setenv=HOMEIO_REPO_BRANCH=v2.0.0-beta.10"]),
      expect.any(Function),
    );
    await expect(scheduleSystemUpdate("2.0.0-beta.10")).rejects.toThrow("available version has changed");
    await expect(scheduleSystemUpdate()).rejects.toThrow("no newer Homeio version");
    expect(execFileMock.mock.calls.filter(([command]) => command === "systemd-run")).toHaveLength(1);
  });

  it("installs the configured branch when the server follows one", async () => {
    vi.stubEnv("HOMEIO_REPO_BRANCH", "v2.0");
    statMock.mockResolvedValueOnce({});
    succeedAllExecFileCalls();
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await scheduleSystemUpdate();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(withLockedUpdateChannel).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledWith(
      "systemd-run",
      expect.arrayContaining(["--setenv=HOMEIO_REPO_BRANCH=v2.0"]),
      expect.any(Function),
    );
  });

  it("refuses to update when no release has been published", async () => {
    statMock.mockResolvedValueOnce({});
    succeedAllExecFileCalls();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    await expect(scheduleSystemUpdate()).rejects.toThrow("no published Homeio release");
    expect(execFileMock).not.toHaveBeenCalledWith("systemd-run", expect.anything(), expect.anything());
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
